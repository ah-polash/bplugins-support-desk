import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateAiReply, DEFAULT_SYSTEM_PROMPT, AI_MODELS, type AiProvider } from '@/lib/ai'
import { safeDecrypt } from '@/lib/crypto'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { ticketId } = await req.json()
    if (!ticketId) return NextResponse.json({ error: 'ticketId is required' }, { status: 400 })

    // Load AI settings
    const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
    if (!settings?.aiEnabled) {
      return NextResponse.json({ error: 'AI reply is not enabled. Ask your admin to configure it in App Settings.' }, { status: 403 })
    }
    if (!settings.aiApiKey) {
      return NextResponse.json({ error: 'AI API key is not configured.' }, { status: 503 })
    }

    const provider = (settings.aiProvider || 'gemini') as AiProvider
    const model = settings.aiModel || AI_MODELS[provider][0].id

    // Load ticket + messages
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { fromEmail: true, fromName: true, body: true, isIncoming: true, createdAt: true },
        },
      },
    })
    if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    if (ticket.messages.length === 0) {
      return NextResponse.json({ error: 'No messages in this ticket yet.' }, { status: 400 })
    }

    const text = await generateAiReply({
      provider,
      apiKey: safeDecrypt(settings.aiApiKey),
      model,
      systemPrompt: settings.aiSystemPrompt || DEFAULT_SYSTEM_PROMPT,
      subject: ticket.subject,
      messages: ticket.messages,
    })

    // Convert plain text to simple HTML paragraphs
    const html = text
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('')

    return NextResponse.json({ text, html })
  } catch (err) {
    console.error('AI suggest-reply error:', err)
    const message = err instanceof Error ? err.message : 'AI request failed'
    if (message.includes('API_KEY') || message.includes('API key') || message.includes('api_key')) {
      return NextResponse.json({ error: 'Invalid API key. Check your AI settings.' }, { status: 502 })
    }
    if (message.includes('quota') || message.includes('QUOTA') || message.includes('rate_limit')) {
      return NextResponse.json({ error: 'AI API quota exceeded. Try again later.' }, { status: 429 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
