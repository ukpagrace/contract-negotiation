import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api, navigate, type InviteInfo, type User } from '@/lib/api'
import { Login } from './Login'

interface InviteProps {
  token: string
  user: User | null
  onUser: (user: User | null) => void
}

export function Invite({ token, user, onUser }: InviteProps) {
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<InviteInfo>(`/invites/${token}`).then(setInvite, (err: Error) => setError(err.message))
  }, [token])

  useEffect(() => {
    if (!invite || user?.email !== invite.email) return
    api<{ contractId: string }>(`/invites/${token}/accept`, { method: 'POST' }).then(
      ({ contractId }) => navigate(`/contracts/${contractId}`),
      (err: Error) => setError(err.message),
    )
  }, [invite, user, token])

  if (error) return <p className="mx-auto max-w-md px-4 py-20 text-sm text-destructive">{error}</p>
  if (!invite) return null

  if (!user) {
    return (
      <Login fixedEmail={invite.email} note={`You've been invited to review "${invite.contractTitle}".`} onDone={onUser} />
    )
  }

  if (user.email !== invite.email) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-20">
        <div className="sheet space-y-5 px-6 py-10 sm:px-10">
          <h2 className="font-serif text-2xl font-medium text-ink">Switch accounts</h2>
          <p className="text-sm text-ink-muted">
            You're signed in as {user.email}, but this invite is for {invite.email}.
          </p>
          <Button
            size="lg"
            className="w-full"
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' })
              onUser(null)
            }}
          >
            Sign in as {invite.email}
          </Button>
        </div>
      </div>
    )
  }

  return <p className="mx-auto max-w-md px-4 py-20 text-sm text-ink-muted">Opening contract…</p>
}
