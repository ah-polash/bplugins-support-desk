import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { SPAM_RULE_TYPES, type SpamRuleType } from '@/lib/spam'

const VALID_TYPES = SPAM_RULE_TYPES.map(t => t.value)

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const rules = await prisma.spamRule.findMany({ orderBy: { createdAt: 'asc' } })
    return NextResponse.json(rules)
  } catch (err) {
    console.error('SpamRules GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { type, value } = await req.json()

    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: 'Invalid rule type' }, { status: 400 })
    }
    if (!value?.trim()) {
      return NextResponse.json({ error: 'Value is required' }, { status: 400 })
    }

    const rule = await prisma.spamRule.create({
      data: { type: type as SpamRuleType, value: value.trim().toLowerCase() },
    })
    return NextResponse.json(rule)
  } catch (err) {
    console.error('SpamRules POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
