import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateAiReply, AI_MODELS, type AiProvider } from '@/lib/ai'
import { safeDecrypt } from '@/lib/crypto'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { apiKey: rawKey, model, provider: rawProvider } = await req.json()

    // Use the provided raw key, or fall back to the stored key
    let apiKey = rawKey?.trim() || null
    const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
    if (!apiKey) apiKey = settings?.aiApiKey ? safeDecrypt(settings.aiApiKey) : null

    if (!apiKey) {
      return NextResponse.json({ error: 'No API key provided or saved' }, { status: 400 })
    }

    const provider = (rawProvider || settings?.aiProvider || 'gemini') as AiProvider
    const testModel = model || AI_MODELS[provider][0].id

    await generateAiReply({
      provider,
      apiKey,
      model: testModel,
      systemPrompt: 'Reply with one word only.',
      subject: 'Connection test',
      messages: [{ fromEmail: 'test@test.com', body: 'Say OK', isIncoming: true, createdAt: new Date() }],
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('AI test error:', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
