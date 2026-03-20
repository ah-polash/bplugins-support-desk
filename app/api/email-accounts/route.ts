import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { encrypt } from '@/lib/crypto'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const accounts = await prisma.emailAccount.findMany({
      select: {
        id: true, name: true, email: true,
        imapHost: true, imapPort: true, imapSecure: true,
        smtpHost: true, smtpPort: true, smtpSecure: true,
        username: true, isActive: true, lastSyncAt: true, createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(accounts)
  } catch (err) {
    console.error('Email accounts GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { name, email, imapHost, imapPort, imapSecure, smtpHost, smtpPort, smtpSecure, username, password } = body

    if (!name?.trim() || !email?.trim() || !imapHost?.trim() || !smtpHost?.trim() || !username?.trim() || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const parsedImapPort = parseInt(imapPort) || 993
    const parsedSmtpPort = parseInt(smtpPort) || 587

    if (parsedImapPort < 1 || parsedImapPort > 65535 || parsedSmtpPort < 1 || parsedSmtpPort > 65535) {
      return NextResponse.json({ error: 'Port must be between 1 and 65535' }, { status: 400 })
    }

    const account = await prisma.emailAccount.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        imapHost: imapHost.trim(),
        imapPort: parsedImapPort,
        imapSecure: imapSecure ?? true,
        smtpHost: smtpHost.trim(),
        smtpPort: parsedSmtpPort,
        smtpSecure: smtpSecure ?? false,
        username: username.trim(),
        password: encrypt(password),
      },
    })

    // Don't return password in response
    const { password: _, ...safeAccount } = account
    return NextResponse.json(safeAccount, { status: 201 })
  } catch (err) {
    console.error('Email accounts POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
