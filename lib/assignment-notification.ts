import { prisma } from './db'
import { sendSystemEmail } from './smtp'

export const ASSIGNMENT_PLACEHOLDERS = [
  '{{agent_name}}',
  '{{agent_email}}',
  '{{ticket_number}}',
  '{{ticket_subject}}',
  '{{ticket_url}}',
  '{{ticket_priority}}',
  '{{ticket_status}}',
  '{{customer_name}}',
  '{{customer_email}}',
] as const

export const DEFAULT_ASSIGNMENT_SUBJECT =
  'New ticket assigned to you: #{{ticket_number}} — {{ticket_subject}}'

export const DEFAULT_ASSIGNMENT_BODY = `<p>Hi {{agent_name}},</p>
<p>A support ticket has been assigned to you:</p>
<ul>
  <li><strong>Ticket:</strong> #{{ticket_number}} — {{ticket_subject}}</li>
  <li><strong>Customer:</strong> {{customer_name}} &lt;{{customer_email}}&gt;</li>
  <li><strong>Priority:</strong> {{ticket_priority}}</li>
  <li><strong>Status:</strong> {{ticket_status}}</li>
</ul>
<p><a href="{{ticket_url}}">Open the ticket</a> to start working on it.</p>`

interface RenderContext {
  agentName: string
  agentEmail: string
  ticketNumber: number
  ticketSubject: string
  ticketUrl: string
  ticketPriority: string
  ticketStatus: string
  customerName: string
  customerEmail: string
}

function renderTemplate(template: string, ctx: RenderContext): string {
  return template
    .replace(/\{\{\s*agent_name\s*\}\}/g, ctx.agentName)
    .replace(/\{\{\s*agent_email\s*\}\}/g, ctx.agentEmail)
    .replace(/\{\{\s*ticket_number\s*\}\}/g, String(ctx.ticketNumber))
    .replace(/\{\{\s*ticket_subject\s*\}\}/g, ctx.ticketSubject)
    .replace(/\{\{\s*ticket_url\s*\}\}/g, ctx.ticketUrl)
    .replace(/\{\{\s*ticket_priority\s*\}\}/g, ctx.ticketPriority)
    .replace(/\{\{\s*ticket_status\s*\}\}/g, ctx.ticketStatus)
    .replace(/\{\{\s*customer_name\s*\}\}/g, ctx.customerName)
    .replace(/\{\{\s*customer_email\s*\}\}/g, ctx.customerEmail)
}

/**
 * Send "ticket assigned to you" email to a list of agents.
 * No-ops if the feature is disabled, the template is empty, or no agents/email account exist.
 * Errors are caught per-agent so one failure does not block the others.
 */
export async function sendAssignmentNotifications(
  ticketId: string,
  newAgentIds: string[],
): Promise<void> {
  if (!newAgentIds.length) return

  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
  if (!settings?.assignmentEmailEnabled) return

  const subjectTpl = settings.assignmentEmailSubject?.trim() || DEFAULT_ASSIGNMENT_SUBJECT
  const bodyTpl = settings.assignmentEmailBody?.trim() || DEFAULT_ASSIGNMENT_BODY
  if (!bodyTpl) return

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { emailAccount: { select: { id: true } } },
  })
  if (!ticket || !ticket.emailAccountId) return

  const agents = await prisma.user.findMany({
    where: { id: { in: newAgentIds }, isActive: true },
    select: { id: true, name: true, email: true },
  })
  if (!agents.length) return

  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
  const ticketUrl = `${baseUrl}/tickets/${ticket.ticketNumber}`

  for (const agent of agents) {
    const ctx: RenderContext = {
      agentName: agent.name || agent.email,
      agentEmail: agent.email,
      ticketNumber: ticket.ticketNumber,
      ticketSubject: ticket.subject,
      ticketUrl,
      ticketPriority: ticket.priority,
      ticketStatus: ticket.status,
      customerName: ticket.fromName || ticket.fromEmail,
      customerEmail: ticket.fromEmail,
    }

    const subject = renderTemplate(subjectTpl, ctx)
    const html = renderTemplate(bodyTpl, ctx)
    const text = html.replace(/<[^>]+>/g, '')

    try {
      await sendSystemEmail({
        accountId: ticket.emailAccountId,
        to: agent.email,
        toName: agent.name || undefined,
        subject,
        html,
        text,
      })
    } catch (err) {
      console.error(`[assignment-notification] Failed to email agent ${agent.email} for ticket #${ticket.ticketNumber}:`, err)
    }
  }
}
