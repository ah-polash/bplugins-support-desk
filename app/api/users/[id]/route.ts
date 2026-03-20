import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const { name, email, password, role, isActive } = await req.json()
    const data: Record<string, unknown> = {}

    if (name?.trim()) data.name = name.trim()
    if (email?.trim()) data.email = email.toLowerCase().trim()
    if (role) {
      const validRoles = ['SUPPORT_AGENT', 'SUPPORT_ADMIN', 'SUPER_ADMIN']
      if (!validRoles.includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
      data.role = role
    }
    if (typeof isActive === 'boolean') data.isActive = isActive
    if (password) {
      if (password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
      data.password = await bcrypt.hash(password, 10)
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true, isActive: true },
    })

    return NextResponse.json(user)
  } catch (err) {
    console.error('User PATCH error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    if (id === session.user.id) {
      return NextResponse.json({ error: 'Cannot deactivate your own account' }, { status: 400 })
    }

    await prisma.user.update({ where: { id }, data: { isActive: false } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('User DELETE error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
