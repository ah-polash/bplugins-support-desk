'use client'
import { useEffect, useState, useCallback, useRef } from 'react'

declare global {
  interface Window {
    grecaptcha: {
      ready: (cb: () => void) => void
      render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void }) => number
      reset: (widgetId: number) => void
    }
    onRecaptchaLoad?: () => void
  }
}

export default function EmbedFormPage() {
  const [products, setProducts] = useState<string[]>([])
  const [disabled, setDisabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<{ ticketNumber: number } | null>(null)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [product, setProduct] = useState('')
  const [hasPaidLicense, setHasPaidLicense] = useState<boolean | null>(null)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  const [recaptchaEnabled, setRecaptchaEnabled] = useState(false)
  const [recaptchaSiteKey, setRecaptchaSiteKey] = useState<string | null>(null)
  const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null)
  const recaptchaRef = useRef<HTMLDivElement>(null)
  const recaptchaWidgetId = useRef<number | null>(null)
  const recaptchaScriptLoaded = useRef(false)

  const renderRecaptcha = useCallback(() => {
    if (!recaptchaSiteKey || !recaptchaRef.current || recaptchaWidgetId.current !== null) return
    if (!window.grecaptcha) return
    window.grecaptcha.ready(() => {
      if (!recaptchaRef.current || recaptchaWidgetId.current !== null) return
      recaptchaWidgetId.current = window.grecaptcha.render(recaptchaRef.current, {
        sitekey: recaptchaSiteKey,
        callback: (token: string) => setRecaptchaToken(token),
        'expired-callback': () => setRecaptchaToken(null),
      })
    })
  }, [recaptchaSiteKey])

  useEffect(() => {
    fetch('/api/embed/submit')
      .then(r => r.json())
      .then(data => {
        if (data.error) { setDisabled(true); return }
        setProducts(data.products || [])
        if (data.products?.length > 0) setProduct(data.products[0])
        if (data.recaptchaEnabled && data.recaptchaSiteKey) {
          setRecaptchaEnabled(true)
          setRecaptchaSiteKey(data.recaptchaSiteKey)
        }
      })
      .catch(() => setDisabled(true))
      .finally(() => setLoading(false))
  }, [])

  // Load reCAPTCHA script when enabled
  useEffect(() => {
    if (!recaptchaEnabled || !recaptchaSiteKey || recaptchaScriptLoaded.current) return
    recaptchaScriptLoaded.current = true

    window.onRecaptchaLoad = () => renderRecaptcha()
    const script = document.createElement('script')
    script.src = 'https://www.google.com/recaptcha/api.js?onload=onRecaptchaLoad&render=explicit'
    script.async = true
    script.defer = true
    document.head.appendChild(script)

    return () => { window.onRecaptchaLoad = undefined }
  }, [recaptchaEnabled, recaptchaSiteKey, renderRecaptcha])

  // Re-render captcha when ref mounts (e.g. after "Submit Another")
  useEffect(() => {
    if (recaptchaEnabled && recaptchaSiteKey && !success && window.grecaptcha) {
      recaptchaWidgetId.current = null
      renderRecaptcha()
    }
  }, [recaptchaEnabled, recaptchaSiteKey, success, renderRecaptcha])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!name.trim()) return setError('Name is required')
    if (!email.trim() || !email.includes('@')) return setError('Valid email is required')
    if (!product) return setError('Please select a product')
    if (hasPaidLicense === null) return setError('Please select license status')
    if (!subject.trim()) return setError('Subject is required')
    if (message.trim().length < 10) return setError('Message must be at least 10 characters')
    if (recaptchaEnabled && !recaptchaToken) return setError('Please complete the reCAPTCHA verification')

    setSubmitting(true)
    try {
      const res = await fetch('/api/embed/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), email: email.trim(), product, hasPaidLicense,
          subject: subject.trim(), message: message.trim(), recaptchaToken,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to submit')
      setSuccess({ ticketNumber: data.ticketNumber })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit')
      // Reset reCAPTCHA on error
      if (recaptchaWidgetId.current !== null && window.grecaptcha) {
        window.grecaptcha.reset(recaptchaWidgetId.current)
        setRecaptchaToken(null)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '40px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ width: 24, height: 24, border: '3px solid #e5e7eb', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (disabled) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#6b7280' }}>
        Support form is currently unavailable.
      </div>
    )
  }

  if (success) {
    return (
      <div style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: 480, margin: '0 auto', padding: '32px 24px', textAlign: 'center',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%', backgroundColor: '#dcfce7',
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px',
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: '0 0 8px' }}>Ticket Created!</h2>
        <p style={{ fontSize: 14, color: '#6b7280', margin: '0 0 4px' }}>
          Your support ticket <strong>#{success.ticketNumber}</strong> has been created successfully.
        </p>
        <p style={{ fontSize: 13, color: '#9ca3af' }}>We&apos;ll get back to you as soon as possible.</p>
        <button
          onClick={() => {
            setSuccess(null); setName(''); setEmail(''); setSubject(''); setMessage(''); setHasPaidLicense(null)
            setRecaptchaToken(null)
            recaptchaWidgetId.current = null
          }}
          style={{
            marginTop: 20, padding: '8px 20px', fontSize: 13, fontWeight: 500,
            color: '#6366f1', backgroundColor: '#eef2ff', border: '1px solid #c7d2fe',
            borderRadius: 6, cursor: 'pointer',
          }}
        >
          Submit Another Ticket
        </button>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 480, margin: '0 auto', padding: '24px' }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: '0 0 20px' }}>Create Support Ticket</h2>

      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 16, fontSize: 13,
          color: '#b91c1c', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6,
        }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Name */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
            Name <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your full name"
            required
            style={{
              width: '100%', padding: '8px 12px', fontSize: 14, border: '1px solid #d1d5db',
              borderRadius: 6, outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Email */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
            Email <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            style={{
              width: '100%', padding: '8px 12px', fontSize: 14, border: '1px solid #d1d5db',
              borderRadius: 6, outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Product Name */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
            Product Name <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <select
            value={product}
            onChange={e => setProduct(e.target.value)}
            required
            style={{
              width: '100%', padding: '8px 12px', fontSize: 14, border: '1px solid #d1d5db',
              borderRadius: 6, outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box',
            }}
          >
            <option value="">Select a product...</option>
            {products.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        {/* Paid License */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 8 }}>
            Have a Paid License? <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <div style={{ display: 'flex', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#374151', cursor: 'pointer' }}>
              <input
                type="radio"
                name="license"
                checked={hasPaidLicense === true}
                onChange={() => setHasPaidLicense(true)}
                style={{ accentColor: '#6366f1' }}
              />
              Yes
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#374151', cursor: 'pointer' }}>
              <input
                type="radio"
                name="license"
                checked={hasPaidLicense === false}
                onChange={() => setHasPaidLicense(false)}
                style={{ accentColor: '#6366f1' }}
              />
              No
            </label>
          </div>
        </div>

        {/* Subject */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
            Subject <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Brief summary of your issue"
            required
            style={{
              width: '100%', padding: '8px 12px', fontSize: 14, border: '1px solid #d1d5db',
              borderRadius: 6, outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Message */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
            Message <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Describe your issue in detail..."
            required
            rows={5}
            style={{
              width: '100%', padding: '8px 12px', fontSize: 14, border: '1px solid #d1d5db',
              borderRadius: 6, outline: 'none', resize: 'vertical', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* reCAPTCHA */}
        {recaptchaEnabled && (
          <div style={{ marginBottom: 20 }}>
            <div ref={recaptchaRef} />
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          style={{
            width: '100%', padding: '10px 20px', fontSize: 14, fontWeight: 600,
            color: '#fff', backgroundColor: submitting ? '#a5b4fc' : '#6366f1',
            border: 'none', borderRadius: 6, cursor: submitting ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Submitting...' : 'Create Support Ticket'}
        </button>
      </form>
    </div>
  )
}
