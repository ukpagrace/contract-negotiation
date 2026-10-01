import { useState, type FormEvent, type ReactNode } from 'react'
import { Dialog } from 'radix-ui'
import { Button } from '@/components/ui/button'
import { api, type ContractDetail, type User } from '@/lib/api'
import { inputClass } from '../Login'

type Party = ContractDetail['parties'][number]

export function Modal({ title, open, onOpenChange, children }: { title: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/30" />
        <Dialog.Content className="sheet fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto px-6 py-8 focus:outline-none sm:px-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <Dialog.Title className="m-0 font-serif text-2xl font-medium text-ink">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" aria-label="Close">Close</Button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function PartyList({ party, user, heading, pendingLabel, signerPicker }: { party: Party; user: User; heading: string; pendingLabel: string; signerPicker?: ReactNode }) {
  return (
    <section>
      <h3 className="text-sm text-ink-muted">{heading}</h3>
      <p className="font-serif text-xl text-ink">{party.orgName}</p>
      {signerPicker ?? (
        <p className="mt-1 text-sm text-ink-muted">
          Signs: <span className="text-ink">{party.signer ? (party.signer.name ?? party.signer.email) : 'Not chosen yet'}</span>
        </p>
      )}
      <ul className="mt-3 space-y-2 text-sm">
        {party.participants.map((p) => (
          <li key={p.id} className="flex justify-between gap-3 text-ink">
            <span className="truncate">{p.user.name ?? p.user.email}{p.user.id === user.id && <span className="text-ink-muted"> (you)</span>}</span>
            {p.user.name && <span className="truncate text-ink-muted">{p.user.email}</span>}
          </li>
        ))}
        {party.invites.map((invite) => (
          <li key={invite.id} className="flex items-center justify-between gap-3 text-ink-muted">
            <span className="truncate">{invite.email}</span>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs">{pendingLabel}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

interface PeopleDialogProps {
  contract: ContractDetail
  user: User
  myParty: Party | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<void>
}

export function PeopleDialog({ contract, user, myParty, open, onOpenChange, onChanged }: PeopleDialogProps) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [orgName, setOrgName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const otherParty = contract.parties.find((party) => party.id !== myParty?.id)

  async function submit(event: FormEvent, action: () => Promise<void>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await action()
      await onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal title="People" open={open} onOpenChange={onOpenChange}>
        <div className="space-y-8">
          {myParty && (
            <PartyList
              party={myParty}
              user={user}
              heading="Your side"
              pendingLabel="Invited"
              signerPicker={
                <label className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
                  Signs:
                  <select
                    className="rounded-sm border border-rule bg-paper px-2 py-1 text-ink"
                    value={myParty.signer?.id ?? ''}
                    disabled={busy || contract.status === 'SIGNED'}
                    onChange={(e) => void submit(e, () => api(`/contracts/${contract.id}/signer`, { method: 'PATCH', body: { userId: e.target.value } }))}
                  >
                    {!myParty.participants.some((p) => p.user.id === myParty.signer?.id) && (
                      <option value={myParty.signer?.id ?? ''} disabled>
                        {myParty.signer ? `${myParty.signer.name ?? myParty.signer.email} (not joined yet)` : 'Choose who signs'}
                      </option>
                    )}
                    {myParty.participants.map((p) => (
                      <option key={p.user.id} value={p.user.id}>{p.user.name ?? p.user.email}</option>
                    ))}
                  </select>
                </label>
              }
            />
          )}
          {otherParty && (
            <PartyList
              party={otherParty}
              user={user}
              heading="Other side"
              pendingLabel={contract.status === 'DRAFT' ? 'Gets it when you send' : 'Invited'}
            />
          )}
        </div>

        {myParty?.role === 'COUNTERPARTY' && (
          <form
            className="mt-8 flex items-end gap-2 border-t border-rule pt-6"
            onSubmit={(e) =>
              submit(e, async () => {
                await api(`/contracts/${contract.id}/org-name`, { method: 'PATCH', body: { orgName } })
                setOrgName('')
              })
            }
          >
            <input className={inputClass} required maxLength={200} placeholder="Rename your organisation" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
            <Button type="submit" variant="outline" disabled={busy}>Rename</Button>
          </form>
        )}
        {error && !inviteOpen && <p className="mt-4 text-sm text-destructive">{error}</p>}

        <div className="mt-8 border-t border-rule pt-6">
          <Button
            onClick={() => {
              setError('')
              setInviteOpen(true)
            }}
          >
            Invite a teammate
          </Button>
        </div>
      </Modal>

      <Modal title="Invite a teammate" open={inviteOpen} onOpenChange={setInviteOpen}>
        <form
          className="space-y-5"
          onSubmit={(e) =>
            submit(e, async () => {
              await api(`/contracts/${contract.id}/invites`, { body: { email, name } })
              setEmail('')
              setName('')
              setInviteOpen(false)
            })
          }
        >
          <p className="text-sm text-ink-muted">They'll join {myParty?.orgName ?? 'your side'} and get an email with a link to this contract.</p>
          <label className="block">
            <span className="text-sm text-ink-muted">Email</span>
            <input className={inputClass} type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm text-ink-muted">Name (optional)</span>
            <input className={inputClass} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" size="lg" disabled={busy}>Send invite</Button>
        </form>
      </Modal>
    </>
  )
}
