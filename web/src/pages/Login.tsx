import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { api, type User } from '@/lib/api'

export const inputClass = 'field'

interface LoginProps {
  fixedEmail?: string
  note?: string
  onDone: (user: User) => void
}

export function Login({ fixedEmail, note, onDone }: LoginProps) {
  const [step, setStep] = useState<'email' | 'code' | 'name'>(fixedEmail ? 'code' : 'email')
  const [email, setEmail] = useState(fixedEmail ?? '')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Dev StrictMode runs effects twice; a second code would invalidate the first email's code.
  const codeSent = useRef(false)
  useEffect(() => {
    if (!fixedEmail || codeSent.current) return
    codeSent.current = true
    void run(() => api('/auth/request-code', { body: { email: fixedEmail } }))
  }, [fixedEmail])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (step === 'email') {
      void run(async () => {
        await api('/auth/request-code', { body: { email } })
        setStep('code')
      })
    } else if (step === 'code') {
      void run(async () => {
        const signedIn = await api<User>('/auth/verify-code', { body: { email, code } })
        if (signedIn.name) onDone(signedIn)
        else {
          setUser(signedIn)
          setStep('name')
        }
      })
    } else if (user) {
      void run(async () => onDone(await api<User>('/auth/me', { method: 'PATCH', body: { name } })))
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-20">
      <form onSubmit={submit} className="sheet space-y-5 px-6 py-10 sm:px-10">
        {note && <p className="border-b border-rule pb-5 text-sm text-ink-muted">{note}</p>}
        {step === 'email' && (
          <>
            <h2 className="font-serif text-2xl font-medium text-ink">Sign in</h2>
            <p className="text-sm text-ink-muted">We'll email you a one-time code.</p>
            <input className={inputClass} type="email" required autoFocus placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </>
        )}
        {step === 'code' && (
          <>
            <h2 className="font-serif text-2xl font-medium text-ink">Check your email</h2>
            <p className="text-sm text-ink-muted">Enter the 6-digit code sent to {email}.</p>
            <input className={`${inputClass} font-serif text-2xl tracking-[0.3em]`} inputMode="numeric" pattern="\d{6}" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
          </>
        )}
        {step === 'name' && (
          <>
            <h2 className="font-serif text-2xl font-medium text-ink">What's your name?</h2>
            <p className="text-sm text-ink-muted">Shown to everyone on your contracts.</p>
            <input className={inputClass} required autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
          </>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {step === 'email' ? 'Send code' : 'Continue'}
        </Button>
        {step === 'code' && !fixedEmail && (
          <button type="button" className="text-sm text-ink-muted underline underline-offset-4 hover:text-ink" onClick={() => setStep('email')}>
            Use a different email
          </button>
        )}
      </form>
    </div>
  )
}
