import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
)

export async function GET(_req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params

  const now = new Date()
  prisma.message
    .updateMany({
      where: { id: messageId, isIncoming: false },
      data: { lastOpenedAt: now, openCount: { increment: 1 } },
    })
    .then(() =>
      prisma.message.updateMany({
        where: { id: messageId, isIncoming: false, firstOpenedAt: null },
        data: { firstOpenedAt: now },
      })
    )
    .catch((err) => console.error('Track open error:', err))

  return new NextResponse(new Uint8Array(TRANSPARENT_GIF), {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(TRANSPARENT_GIF.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  })
}
