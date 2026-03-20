import { prisma } from './db'
import { sendSystemEmail } from './smtp'

/**
 * Auto-close resolved tickets that have had no incoming customer reply
 * for longer than the configured autoCloseDays.
 *
 * Called periodically from the email-sync worker.
 */
export async function runAutoClose(): Promise<{ closed: number; emailed: number; errors: number }> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
  if (!settings?.autoCloseEnabled) return { closed: 0, emailed: 0, errors: 0 }

  const days = settings.autoCloseDays || 7
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  // Find resolved tickets where resolvedAt is older than the cutoff
  // and no incoming message exists after resolvedAt
  const candidates = await prisma.ticket.findMany({
    where: {
      status: 'RESOLVED',
      resolvedAt: { not: null, lte: cutoff },
    },
    include: {
      messages: {
        where: { isIncoming: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true },
      },
      emailAccount: { select: { id: true } },
    },
  })

  let closed = 0
  let emailed = 0
  let errors = 0
  const emailBody = settings.autoCloseEmailBody?.trim() || null

  for (const ticket of candidates) {
    // If the customer replied after the ticket was resolved, skip
    const lastIncoming = ticket.messages[0]
    if (lastIncoming && ticket.resolvedAt && lastIncoming.createdAt > ticket.resolvedAt) {
      continue
    }

    try {
      // Close the ticket
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'CLOSED' },
      })

      await prisma.activity.create({
        data: {
          ticketId: ticket.id,
          action: 'status_changed',
          metadata: { to: 'CLOSED', reason: 'auto_close', days },
        },
      })

      closed++

      // Send email if template is configured
      if (emailBody && ticket.emailAccountId) {
        try {
          const plainText = emailBody.replace(/<[^>]+>/g, '')
          await sendSystemEmail({
            accountId: ticket.emailAccountId,
            to: ticket.fromEmail,
            toName: ticket.fromName || undefined,
            subject: `Re: ${ticket.subject}`,
            html: emailBody,
            text: plainText,
          })

          await prisma.message.create({
            data: {
              ticketId: ticket.id,
              body: plainText,
              htmlBody: emailBody,
              fromEmail: 'system',
              fromName: 'System',
              isIncoming: false,
            },
          })

          emailed++
        } catch (err) {
          console.error(`[auto-close] Failed to send email for ticket ${ticket.ticketNumber}:`, err)
          errors++
        }
      }
    } catch (err) {
      console.error(`[auto-close] Failed to close ticket ${ticket.ticketNumber}:`, err)
      errors++
    }
  }

  return { closed, emailed, errors }
}
