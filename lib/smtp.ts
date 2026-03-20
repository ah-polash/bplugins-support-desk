import nodemailer from 'nodemailer'
import { prisma } from './db'
import { safeDecrypt } from './crypto'

interface SendReplyOptions {
  accountId: string
  to: string
  toName?: string
  subject: string
  html: string
  text: string
  inReplyTo?: string
  references?: string
  attachments?: Array<{
    filename: string
    path: string
    contentType: string
  }>
}

export async function sendReply(options: SendReplyOptions): Promise<string> {
  const account = await prisma.emailAccount.findUnique({ where: { id: options.accountId } })
  if (!account) throw new Error('Email account not found')

  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth: { user: account.username, pass: safeDecrypt(account.password) },
  })

  const headers: Record<string, string> = {}
  if (options.inReplyTo) headers['In-Reply-To'] = options.inReplyTo
  if (options.references) headers['References'] = options.references

  const info = await transporter.sendMail({
    from: `"bPlugins Support" <${account.email}>`,
    to: options.toName ? `"${options.toName}" <${options.to}>` : options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    headers,
    attachments: options.attachments,
  })

  return info.messageId
}

export async function testSmtpConnection(accountId: string): Promise<boolean> {
  const account = await prisma.emailAccount.findUnique({ where: { id: accountId } })
  if (!account) return false

  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth: { user: account.username, pass: safeDecrypt(account.password) },
  })

  try {
    await transporter.verify()
    return true
  } catch {
    return false
  }
}

// Send a standalone system email (no threading headers) — used for auto-reply and satisfaction survey
export async function sendSystemEmail(options: Omit<SendReplyOptions, 'inReplyTo' | 'references'>): Promise<string> {
  return sendReply(options)
}
