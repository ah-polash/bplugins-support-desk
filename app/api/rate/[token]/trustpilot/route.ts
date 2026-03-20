import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// Prevent Next.js from caching this route — every click must run the handler to record the event
export const dynamic = 'force-dynamic'

// GET /api/rate/[token]/trustpilot
// Marks reviewClicked=true then redirects the browser to the Trustpilot URL.
// Using a server redirect guarantees tracking even if the browser cancels a fetch().
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  try {
    const [rating, settings] = await Promise.all([
      prisma.satisfactionRating.findUnique({ where: { token } }),
      prisma.appSettings.findUnique({ where: { id: 'singleton' } }),
    ])

    if (rating) {
      await prisma.satisfactionRating.update({
        where: { token },
        data: { reviewClicked: true },
      })
    }

    const destination = settings?.trustpilotUrl || 'https://www.trustpilot.com'
    return NextResponse.redirect(destination, { status: 302 })
  } catch {
    // Always redirect even on error so the user still reaches Trustpilot
    const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } }).catch(() => null)
    return NextResponse.redirect(settings?.trustpilotUrl || 'https://www.trustpilot.com', { status: 302 })
  }
}
