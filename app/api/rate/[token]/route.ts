import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const rating = await prisma.satisfactionRating.findUnique({
      where: { token },
      include: {
        ticket: { select: { subject: true, fromName: true } },
      },
    })

    if (!rating) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })

    return NextResponse.json({
      subject: rating.ticket.subject,
      fromName: rating.ticket.fromName,
      alreadyRated: !!rating.ratedAt,
      rating: rating.rating,
      trustpilotUrl: settings?.trustpilotUrl ?? null,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const { rating, feedback } = await req.json()

    const validRatings = ['DISSATISFIED', 'NEUTRAL', 'SATISFIED']
    if (!validRatings.includes(rating)) {
      return NextResponse.json({ error: 'Invalid rating' }, { status: 400 })
    }

    const existing = await prisma.satisfactionRating.findUnique({ where: { token } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (existing.ratedAt) return NextResponse.json({ error: 'Already rated' }, { status: 409 })

    await prisma.satisfactionRating.update({
      where: { token },
      data: {
        rating,
        feedback: feedback?.trim() || null,
        ratedAt: new Date(),
      },
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH — mark Trustpilot review button as clicked
export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const existing = await prisma.satisfactionRating.findUnique({ where: { token } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.satisfactionRating.update({
      where: { token },
      data: { reviewClicked: true },
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
