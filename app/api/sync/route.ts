import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isAdminRole } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { syncEmailAccount } from '@/lib/imap'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isAdminRole(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const accounts = await prisma.emailAccount.findMany({ where: { isActive: true } })
    const results: Array<{ account: string; success: boolean; error?: string }> = []

    for (const account of accounts) {
      try {
        await syncEmailAccount(account.id)
        results.push({ account: account.email, success: true })
      } catch (err) {
        results.push({ account: account.email, success: false, error: String(err) })
      }
    }

    return NextResponse.json({ results })
  } catch (err) {
    console.error('Sync POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
