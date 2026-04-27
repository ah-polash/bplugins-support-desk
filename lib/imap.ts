import { ImapFlow } from 'imapflow'
import { simpleParser, ParsedMail } from 'mailparser'
import { prisma } from './db'
import { saveBuffer } from './storage'
import { sendSystemEmail } from './smtp'
import { getActiveSpamRules, checkIsSpam } from './spam'
import { safeDecrypt } from './crypto'
import { sendAssignmentNotifications } from './assignment-notification'

export async function syncEmailAccount(accountId: string) {
  const account = await prisma.emailAccount.findUnique({ where: { id: accountId } })
  if (!account || !account.isActive) return

  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.username, pass: safeDecrypt(account.password) },
    logger: false,
    connectionTimeout: 30000,
  })

  // Prevent socket errors from becoming uncaughtException
  client.on('error', (err: Error) => {
    console.error(`[imap] Connection error for ${account.email}:`, err.message)
  })

  try {
    await client.connect()

    // Use mailbox lock to safely fetch + delete
    const lock = await client.getMailboxLock('INBOX')
    try {
      // First pass: collect all unseen message sources
      const collected: Array<{ uid: number; source: Buffer }> = []
      for await (const msg of client.fetch({ seen: false }, { source: true, uid: true })) {
        if (msg.source) collected.push({ uid: msg.uid, source: msg.source as Buffer })
      }

      // Second pass: process each message (DB writes happen outside the fetch loop)
      const processedUids: number[] = []
      for (const { uid, source } of collected) {
        try {
          const parsed = await simpleParser(source)
          await processEmail(parsed, account.id, account.email)
          processedUids.push(uid)
        } catch (err) {
          console.error('Error processing message:', err)
        }
      }

      // Bulk delete processed messages from IMAP server
      if (processedUids.length > 0) {
        try {
          await client.messageDelete(processedUids, { uid: true })
        } catch (delErr) {
          console.error('Could not delete messages from IMAP server:', delErr)
        }
      }
    } finally {
      lock.release()
    }

    await prisma.emailAccount.update({
      where: { id: accountId },
      data: { lastSyncAt: new Date() },
    })
  } catch (err) {
    console.error(`IMAP sync error for ${account.email}:`, err)
    throw err
  } finally {
    try { await client.logout() } catch { /* ignore logout errors */ }
  }
}

async function autoAssignTicket(ticketId: string): Promise<string | null> {
  // Check if there's a default assignee set in AppSettings
  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })

  if (settings?.defaultAssigneeId) {
    const user = await prisma.user.findUnique({ where: { id: settings.defaultAssigneeId } })
    if (user && user.isActive) {
      await prisma.ticketAssignee.create({ data: { ticketId, userId: user.id } })
      await prisma.activity.create({
        data: { ticketId, userId: user.id, action: 'assigned', metadata: { auto: true, source: 'default_assignee' } },
      })
      sendAssignmentNotifications(ticketId, [user.id]).catch(err =>
        console.error('Assignment notification error:', err)
      )
      return user.id
    }
  }

  // Fall back to least-loaded active agent
  const agents = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      role: true,
      _count: { select: { ticketAssignments: { where: { ticket: { status: { in: ['OPEN', 'PENDING'] } } } } } },
    },
  })

  if (agents.length === 0) return null

  // Prefer agents, fall back to admins
  const sorted = agents.sort((a, b) => {
    const roleDiff = (a.role === 'SUPPORT_AGENT' ? 0 : 1) - (b.role === 'SUPPORT_AGENT' ? 0 : 1)
    if (roleDiff !== 0) return roleDiff
    return a._count.ticketAssignments - b._count.ticketAssignments
  })
  const agent = sorted[0]

  await prisma.ticketAssignee.create({ data: { ticketId, userId: agent.id } })
  await prisma.activity.create({
    data: { ticketId, userId: agent.id, action: 'assigned', metadata: { auto: true } },
  })
  sendAssignmentNotifications(ticketId, [agent.id]).catch(err =>
    console.error('Assignment notification error:', err)
  )
  return agent.id
}

async function processEmail(parsed: ParsedMail, accountId: string, accountEmail: string) {
  const messageId = parsed.messageId
  const inReplyTo = parsed.inReplyTo
  const references = parsed.references

  // Skip if we sent it
  const fromEmail = parsed.from?.value[0]?.address?.toLowerCase()
  if (!fromEmail || fromEmail === accountEmail.toLowerCase()) return

  // Check if this message is already stored
  if (messageId) {
    const existing = await prisma.message.findFirst({ where: { emailMsgId: messageId } })
    if (existing) return
  }

  // Try to find existing ticket via In-Reply-To or References
  let ticket = null

  if (inReplyTo) {
    ticket = await prisma.ticket.findFirst({
      where: { messages: { some: { emailMsgId: inReplyTo } } },
    })
  }

  if (!ticket && references) {
    const refList = Array.isArray(references) ? references : [references]
    for (const ref of refList) {
      ticket = await prisma.ticket.findFirst({
        where: { messages: { some: { emailMsgId: ref } } },
      })
      if (ticket) break
    }
  }

  const fromName = parsed.from?.value[0]?.name || fromEmail
  const subject = parsed.subject || '(No Subject)'
  const htmlBody = parsed.html || ''
  const textBody = parsed.text || ''

  const isNewTicket = !ticket

  if (!ticket) {
    // Check spam rules before creating a new ticket
    const spamRules = await getActiveSpamRules()
    const spamCheck = checkIsSpam(spamRules, subject, fromEmail, fromName, textBody)
    const isSpam = spamCheck.isSpam

    // Upsert contact
    let contactId: string | null = null
    try {
      const contact = await prisma.contact.upsert({
        where: { email: fromEmail.toLowerCase() },
        update: { name: fromName || undefined },
        create: { email: fromEmail.toLowerCase(), name: fromName || undefined },
      })
      contactId = contact.id
    } catch { /* ignore duplicate race */ }

    ticket = await prisma.ticket.create({
      data: {
        subject,
        fromEmail,
        fromName,
        messageId: messageId || undefined,
        emailAccountId: accountId,
        contactId,
        status: isSpam ? 'SPAM' : 'OPEN',
        priority: 'MEDIUM',
      },
    })

    await prisma.activity.create({
      data: {
        ticketId: ticket.id,
        action: 'ticket_created',
        metadata: {
          source: 'email',
          from: fromEmail,
          ...(isSpam && { spam: true, spamRule: spamCheck.ruleType, spamValue: spamCheck.ruleValue }),
        },
      },
    })

    if (!isSpam) {
      // Auto-assign
      await autoAssignTicket(ticket.id)

      // Send auto-reply if configured
      const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
      if (settings?.autoReplyBody) {
        sendSystemEmail({
          accountId,
          to: fromEmail,
          toName: fromName,
          subject: `Re: ${subject}`,
          html: settings.autoReplyBody,
          text: settings.autoReplyBody.replace(/<[^>]+>/g, ''),
        }).catch(err => console.error('Auto-reply send error:', err))
      }
    }
  }

  // Create message
  const message = await prisma.message.create({
    data: {
      ticketId: ticket.id,
      body: textBody,
      htmlBody,
      fromEmail,
      fromName,
      isIncoming: true,
      emailMsgId: messageId || undefined,
    },
  })

  // Handle attachments
  if (parsed.attachments?.length) {
    for (const att of parsed.attachments) {
      try {
        const stored = await saveBuffer(
          att.content,
          att.filename || 'attachment',
          att.contentType
        )
        await prisma.attachment.create({
          data: {
            ticketId: ticket.id,
            messageId: message.id,
            filename: stored.filename,
            mimeType: stored.mimeType,
            size: stored.size,
            url: stored.url,
          },
        })
      } catch (err) {
        console.error('Attachment save error:', err)
      }
    }
  }

  // If existing ticket was resolved/closed, re-open it and move back to OPEN (My Inbox)
  if (!isNewTicket && (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED')) {
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'OPEN', resolvedAt: null },
    })
    await prisma.activity.create({
      data: { ticketId: ticket.id, action: 'status_changed', metadata: { from: ticket.status, to: 'OPEN', reason: 'customer_reply' } },
    })
  } else if (!isNewTicket && ticket.status === 'PENDING') {
    // Customer replied to a pending ticket — move back to OPEN (returns to My Inbox)
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'OPEN' },
    })
    await prisma.activity.create({
      data: { ticketId: ticket.id, action: 'status_changed', metadata: { from: 'PENDING', to: 'OPEN', reason: 'customer_reply' } },
    })
  }
}
