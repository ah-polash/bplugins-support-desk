'use client'
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

type Rating = 'DISSATISFIED' | 'NEUTRAL' | 'SATISFIED'

interface TicketInfo {
  subject: string
  fromName: string | null
  alreadyRated: boolean
  rating: Rating | null
  trustpilotUrl: string | null
}

const CONFIG: Record<Rating, {
  emoji: string
  headline: string
  subline: string
  feedbackLabel: string
  feedbackPlaceholder: string
  color: string
  bg: string
  border: string
}> = {
  DISSATISFIED: {
    emoji: '😞',
    headline: "We're truly sorry to hear that.",
    subline: 'Your experience matters to us. Please tell us what went wrong so we can make it right.',
    feedbackLabel: 'What went wrong? (required)',
    feedbackPlaceholder: 'Please describe your dissatisfaction...',
    color: 'text-red-700 dark:text-red-300',
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
  },
  NEUTRAL: {
    emoji: '😐',
    headline: 'Thank you for your feedback.',
    subline: "We're always looking to improve. What could we have done better?",
    feedbackLabel: 'How can we improve?',
    feedbackPlaceholder: 'Share your suggestions...',
    color: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-200 dark:border-amber-800',
  },
  SATISFIED: {
    emoji: '😊',
    headline: 'Thank you! We love hearing that.',
    subline: "We're glad we could help. If you have a moment, we'd really appreciate a quick review.",
    feedbackLabel: "Anything else you'd like to share? (optional)",
    feedbackPlaceholder: 'Your kind words mean a lot to us...',
    color: 'text-green-700 dark:text-green-300',
    bg: 'bg-green-50 dark:bg-green-900/20',
    border: 'border-green-200 dark:border-green-800',
  },
}

export default function RatePage() {
  const { token } = useParams<{ token: string }>()
  const searchParams = useSearchParams()
  const rParam = (searchParams.get('r') ?? '') as Rating

  const [ticketInfo, setTicketInfo] = useState<TicketInfo | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  // Redirect URL — server marks reviewClicked=true then bounces user to Trustpilot
  const trustpilotRedirectUrl = `/api/rate/${token}/trustpilot`

  const rating: Rating | null = ['DISSATISFIED', 'NEUTRAL', 'SATISFIED'].includes(rParam)
    ? rParam
    : null

  useEffect(() => {
    fetch(`/api/rate/${token}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); return null }
        return r.json()
      })
      .then(data => {
        if (data) setTicketInfo(data)
      })
      .catch(() => setNotFound(true))
  }, [token])

  const handleSubmit = async () => {
    if (!rating) return
    const cfg = CONFIG[rating]
    if (rating === 'DISSATISFIED' && !feedback.trim()) {
      setError('Please describe your dissatisfaction before submitting.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/rate/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, feedback: feedback.trim() || undefined }),
      })
      if (res.status === 409) {
        setSubmitted(true)
        return
      }
      if (!res.ok) throw new Error('Submission failed')
      setSubmitted(true)
      void cfg // suppress unused warning
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // Loading
  if (!ticketInfo && !notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    )
  }

  // Not found
  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
        <div className="max-w-md w-full text-center">
          <p className="text-4xl mb-4">🔍</p>
          <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-2">Link not found</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">This rating link is invalid or has expired.</p>
        </div>
      </div>
    )
  }

  // No rating in URL
  if (!rating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
        <div className="max-w-md w-full text-center">
          <p className="text-4xl mb-4">❓</p>
          <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-2">Invalid link</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Please use one of the rating buttons from the email.</p>
        </div>
      </div>
    )
  }

  const cfg = CONFIG[rating]

  // Already rated (either from DB or just submitted now)
  if (ticketInfo?.alreadyRated || submitted) {
    const wasRating = ticketInfo?.rating ?? rating
    const wasCfg = CONFIG[wasRating as Rating] ?? cfg
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
        <div className={`max-w-md w-full rounded-2xl border ${wasCfg.border} ${wasCfg.bg} p-8 text-center shadow-sm`}>
          <p className="text-5xl mb-4">{wasCfg.emoji}</p>
          <h1 className={`text-xl font-bold ${wasCfg.color} mb-2`}>
            {submitted && !ticketInfo?.alreadyRated ? 'Feedback received!' : 'Already submitted'}
          </h1>
          <p className="text-gray-600 dark:text-gray-300 text-sm">
            {submitted && !ticketInfo?.alreadyRated
              ? 'Thank you for taking the time to share your experience.'
              : 'You have already submitted your rating for this ticket.'}
          </p>
          {rating === 'SATISFIED' && submitted && ticketInfo?.trustpilotUrl && (
            <a
              href={trustpilotRedirectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-block rounded-lg bg-[#00b67a] px-5 py-3 text-sm font-semibold text-white hover:bg-[#009e6b] transition-colors"
            >
              ⭐ Leave a 5-Star Review on Trustpilot
            </a>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
      <div className="max-w-lg w-full">
        {/* Header card */}
        <div className={`rounded-2xl border ${cfg.border} ${cfg.bg} p-8 text-center mb-4 shadow-sm`}>
          <p className="text-5xl mb-3">{cfg.emoji}</p>
          <h1 className={`text-xl font-bold ${cfg.color} mb-1`}>{cfg.headline}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">{cfg.subline}</p>
          {ticketInfo?.subject && (
            <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
              Ticket: <span className="font-medium text-gray-600 dark:text-gray-300">{ticketInfo.subject}</span>
            </p>
          )}
        </div>

        {/* Trustpilot CTA for SATISFIED — shown before feedback too */}
        {rating === 'SATISFIED' && ticketInfo?.trustpilotUrl && (
          <div className="rounded-xl border border-green-200 dark:border-green-800 bg-white dark:bg-gray-800 p-5 mb-4 text-center shadow-sm">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-3">
              Would you like to share your experience publicly?
            </p>
            <a
              href={trustpilotRedirectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-lg bg-[#00b67a] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#009e6b] transition-colors"
            >
              ⭐ Leave a 5-Star Review on Trustpilot
            </a>
          </div>
        )}

        {/* Feedback form */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {cfg.feedbackLabel}
          </label>
          <textarea
            rows={4}
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder={cfg.feedbackPlaceholder}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
          />
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            {submitting ? 'Submitting…' : 'Submit Feedback'}
          </button>
        </div>
      </div>
    </div>
  )
}
