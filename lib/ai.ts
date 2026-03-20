import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'

export type AiProvider = 'gemini' | 'openai' | 'openrouter'

export const DEFAULT_PROVIDER: AiProvider = 'gemini'

export const AI_PROVIDERS: { id: AiProvider; label: string }[] = [
  { id: 'gemini',      label: 'Google Gemini (AI Studio)' },
  { id: 'openai',      label: 'OpenAI' },
  { id: 'openrouter',  label: 'OpenRouter' },
]

export const AI_MODELS: Record<AiProvider, { id: string; label: string }[]> = {
  gemini: [
    { id: 'gemini-2.0-flash',   label: 'Gemini 2.0 Flash (Recommended)' },
    { id: 'gemini-1.5-flash',   label: 'Gemini 1.5 Flash (Lightweight)' },
    { id: 'gemini-1.5-pro',     label: 'Gemini 1.5 Pro (Most capable)' },
  ],
  openai: [
    { id: 'gpt-4o',             label: 'GPT-4o (Recommended)' },
    { id: 'gpt-4o-mini',        label: 'GPT-4o Mini (Fast & cheap)' },
    { id: 'gpt-4-turbo',        label: 'GPT-4 Turbo' },
    { id: 'gpt-3.5-turbo',      label: 'GPT-3.5 Turbo (Economy)' },
  ],
  openrouter: [
    { id: 'openai/gpt-4o',                         label: 'GPT-4o (via OpenRouter)' },
    { id: 'anthropic/claude-3.5-sonnet',            label: 'Claude 3.5 Sonnet (via OpenRouter)' },
    { id: 'anthropic/claude-3-haiku',               label: 'Claude 3 Haiku (via OpenRouter)' },
    { id: 'google/gemini-2.0-flash-001',            label: 'Gemini 2.0 Flash (via OpenRouter)' },
    { id: 'meta-llama/llama-3.3-70b-instruct',      label: 'Llama 3.3 70B (via OpenRouter)' },
  ],
}

export const DEFAULT_SYSTEM_PROMPT =
  'You are a professional and empathetic customer support agent. ' +
  'Write clear, concise, and helpful replies. ' +
  'Do not include greetings (e.g. "Hi,") or sign-offs (e.g. "Best regards") — those are handled separately. ' +
  'Reply only with the email body text. Use plain paragraphs, no bullet points unless necessary.'

/** Mask an API key — shows only the last 4 characters */
export function maskApiKey(key: string): string {
  if (key.length <= 4) return '****'
  return '•'.repeat(Math.min(key.length - 4, 20)) + key.slice(-4)
}

interface Message {
  fromName?: string | null
  fromEmail: string
  body: string
  isIncoming: boolean
  createdAt: string | Date
}

function buildPrompt(systemPrompt: string, subject: string, messages: Message[]): string {
  const conversationLines = messages
    .slice(-10)
    .map((msg) => {
      const sender = msg.isIncoming
        ? (msg.fromName ? `${msg.fromName} <${msg.fromEmail}>` : msg.fromEmail)
        : 'Support Agent'
      const date = new Date(msg.createdAt).toLocaleString('en', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
      return `[${sender} — ${date}]:\n${msg.body.trim()}`
    })
    .join('\n\n')

  return `${systemPrompt}

---
Support ticket subject: "${subject}"

Conversation history:
${conversationLines}

---
Write a helpful reply to the customer's latest message above. Output only the reply body text.`
}

export async function generateAiReply({
  provider = 'gemini',
  apiKey,
  model,
  systemPrompt,
  subject,
  messages,
}: {
  provider?: AiProvider
  apiKey: string
  model: string
  systemPrompt: string
  subject: string
  messages: Message[]
}): Promise<string> {
  const prompt = buildPrompt(systemPrompt, subject, messages)

  if (provider === 'gemini') {
    const genAI = new GoogleGenerativeAI(apiKey)
    const gemini = genAI.getGenerativeModel({ model })
    const result = await gemini.generateContent(prompt)
    const text = result.response.text().trim()
    if (!text) throw new Error('AI returned an empty response')
    return text
  }

  // OpenAI and OpenRouter both use the openai SDK
  const client = provider === 'openrouter'
    ? new OpenAI({
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': 'https://bplugins.com',
          'X-Title': 'bPlugins Support Desk',
        },
      })
    : new OpenAI({ apiKey })

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
  })

  const text = completion.choices[0]?.message?.content?.trim()
  if (!text) throw new Error('AI returned an empty response')
  return text
}
