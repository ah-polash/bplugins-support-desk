import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { testSmtpConnection } from '@/lib/smtp'
import { encrypt } from '@/lib/crypto'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params
    const body = await req.json()
    const { name, imapHost, imapPort, imapSecure, smtpHost, smtpPort, smtpSecure, username, password, isActive } = body
    const data: Record<string, unknown> = {}

    if (name?.trim()) data.name = name.trim()
    if (imapHost?.trim()) data.imapHost = imapHost.trim()
    if (imapPort !== undefined) {
      const port = parseInt(imapPort)
      if (port < 1 || port > 65535) return NextResponse.json({ error: 'Invalid IMAP port' }, { status: 400 })
      data.imapPort = port
    }
    if (typeof imapSecure === 'boolean') data.imapSecure = imapSecure
    if (smtpHost?.trim()) data.smtpHost = smtpHost.trim()
    if (smtpPort !== undefined) {
      const port = parseInt(smtpPort)
      if (port < 1 || port > 65535) return NextResponse.json({ error: 'Invalid SMTP port' }, { status: 400 })
      data.smtpPort = port
    }
    if (typeof smtpSecure === 'boolean') data.smtpSecure = smtpSecure
    if (username?.trim()) data.username = username.trim()
    if (password) data.password = encrypt(password)
    if (typeof isActive === 'boolean') data.isActive = isActive

    const account = await prisma.emailAccount.update({ where: { id }, data })
    const { password: _, ...safeAccount } = account
    return NextResponse.json(safeAccount)
  } catch (err) {
    console.error('Email account PATCH error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params
    await prisma.emailAccount.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Email account DELETE error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Test SMTP connection: POST /api/email-accounts/[id]
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params
    const ok = await testSmtpConnection(id)
    return NextResponse.json({ success: ok })
  } catch (err) {
    console.error('Email account test error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
