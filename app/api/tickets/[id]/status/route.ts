import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isAdminRole } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendSystemEmail } from '@/lib/smtp'
import { randomUUID } from 'crypto'

function buildSatisfactionEmail(
  body: string,
  links: { dissatisfied: string; neutral: string; satisfied: string }
): string {
  const buttonsHtml = `
<div style="margin-top:24px;font-family:sans-serif;">
  <p style="color:#374151;font-size:15px;font-weight:600;margin:0 0 4px;">How would you rate our support?</p>
  <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">Click a button to share your experience</p>
  <table cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td style="padding:0 8px 0 0;">
        <a href="${links.dissatisfied}" style="display:inline-block;background-color:#ef4444;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;font-family:sans-serif;">
          😞 Dissatisfied
        </a>
      </td>
      <td style="padding:0 8px;">
        <a href="${links.neutral}" style="display:inline-block;background-color:#f59e0b;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;font-family:sans-serif;">
          😐 Neutral
        </a>
      </td>
      <td style="padding:0 0 0 8px;">
        <a href="${links.satisfied}" style="display:inline-block;background-color:#22c55e;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;font-family:sans-serif;">
          😊 Satisfied
        </a>
      </td>
    </tr>
  </table>
</div>`

  return body + buttonsHtml
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: numStr } = await params
    const ticketNumber = parseInt(numStr)
    if (isNaN(ticketNumber)) return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 })
    const { status } = await req.json()
    const validStatuses = ['OPEN', 'PENDING', 'RESOLVED', 'CLOSED']
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const ticket = await prisma.ticket.findUnique({
      where: { ticketNumber },
      include: { assignees: { select: { userId: true } }, emailAccount: true },
    })
    if (!ticket) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const ticketId = ticket.id

    const isAssigned = ticket.assignees.some(a => a.userId === session.user.id)
    if (!isAdminRole(session.user.role) && !isAssigned) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (status === 'CLOSED' && !isAdminRole(session.user.role)) {
      return NextResponse.json({ error: 'Only admins can close tickets' }, { status: 403 })
    }

    const updated = await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        status,
        resolvedAt: status === 'RESOLVED' || status === 'CLOSED' ? new Date() : null,
      },
    })

    await prisma.activity.create({
      data: {
        ticketId,
        userId: session.user.id,
        action: 'status_changed',
        metadata: { from: ticket.status, to: status },
      },
    })

    // Send satisfaction survey when ticket is RESOLVED or CLOSED
    if (status === 'RESOLVED' || status === 'CLOSED') {
      const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
      if (settings?.satisfactionSurveyBody) {
        // Only send once — skip if a rating token already exists for this ticket
        const existing = await prisma.satisfactionRating.findUnique({ where: { ticketId } })
        if (!existing) {
        const token = randomUUID()
        await prisma.satisfactionRating.create({
          data: { ticketId, token },
        })

        const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
        const links = {
          dissatisfied: `${baseUrl}/rate/${token}?r=DISSATISFIED`,
          neutral:      `${baseUrl}/rate/${token}?r=NEUTRAL`,
          satisfied:    `${baseUrl}/rate/${token}?r=SATISFIED`,
        }

        const html = buildSatisfactionEmail(settings.satisfactionSurveyBody, links)
        const text = settings.satisfactionSurveyBody.replace(/<[^>]+>/g, '') +
          '\n\nDissatisfied: ' + links.dissatisfied +
          '\nNeutral: ' + links.neutral +
          '\nSatisfied: ' + links.satisfied

        sendSystemEmail({
          accountId: ticket.emailAccountId,
          to: ticket.fromEmail,
          toName: ticket.fromName ?? undefined,
          subject: `Re: ${ticket.subject}`,
          html,
          text,
        }).catch(err => console.error('Satisfaction survey send error:', err))
        } // end if (!existing)
      }
    }

    return NextResponse.json(updated)
  } catch (err) {
    console.error('Status POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
