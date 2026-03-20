import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
    return NextResponse.json({
      aiEnabled: !!(settings?.aiEnabled && settings?.aiApiKey),
    })
  } catch (err) {
    console.error('AI status error:', err)
    return NextResponse.json({ aiEnabled: false })
  }
}
