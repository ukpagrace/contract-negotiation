import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { JSONContent } from '@tiptap/react'
import { SimpleEditor } from '@/components/tiptap-templates/simple/simple-editor'
import { Button } from '@/components/ui/button'
import { api, navigate, type ContractDetail, type ContractSummary, type LockHolder, type User } from '@/lib/api'
import { inputClass } from './Login'

const statusLabels: Record<string, string> = {
  DRAFT: 'Draft',
  WITH_COUNTERPARTY: 'With counterparty',
  WITH_PROPOSER: 'With proposer',
  READY_TO_SIGN: 'Ready to sign',
  SIGNED: 'Signed',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="rounded-full border border-rule px-2.5 py-0.5 text-xs text-ink-muted">{statusLabels[status]}</span>
  )
}

export function ContractList() {
  const [contracts, setContracts] = useState<ContractSummary[] | null>(null)

  useEffect(() => {
    void api<ContractSummary[]>('/contracts').then(setContracts)
  }, [])

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-end justify-between">
        <h2 className="m-0 font-serif text-3xl font-medium text-ink">Your contracts</h2>
        <Button size="lg" onClick={() => navigate('/new')}>
          Start a contract
        </Button>
      </div>
      <div className="sheet">
        {contracts?.length === 0 && (
          <p className="px-6 py-12 text-center text-sm text-ink-muted sm:px-10">
            No contracts yet. Start one to invite the other side.
          </p>
        )}
        {contracts?.map((contract) => (
          <button
            key={contract.id}
            onClick={() => navigate(`/contracts/${contract.id}`)}
            className="flex w-full items-center justify-between gap-4 border-b border-rule px-6 py-5 text-left last:border-b-0 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none sm:px-10"
          >
            <span className="font-serif text-lg text-ink">{contract.title}</span>
            <StatusBadge status={contract.status} />
          </button>
        ))}
      </div>
    </div>
  )
}

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }
const HEARTBEAT_MS = 20_000
const IDLE_MS = 60_000

function DocumentSection({ contract, user, canEdit }: { contract: ContractDetail; user: User; canEdit: boolean }) {
  const id = contract.id
  const [saved, setSaved] = useState<JSONContent>(contract.draftContent ?? EMPTY_DOC)
  const [version, setVersion] = useState(0)
  const [editing, setEditing] = useState(false)
  const [lock, setLock] = useState<LockHolder | null>(null)
  const [notice, setNotice] = useState<string>((history.state as { notice?: string } | null)?.notice ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const latest = useRef<JSONContent>(saved)
  const lastActivity = useRef(Date.now())
  const fileInput = useRef<HTMLInputElement>(null)

  // Teammates learn about the lock by polling until live updates arrive.
  useEffect(() => {
    if (editing) return
    const check = () => api<LockHolder | null>(`/contracts/${id}/lock`).then(setLock, () => undefined)
    void check()
    const timer = setInterval(check, 10_000)
    return () => clearInterval(timer)
  }, [editing, id])

  useEffect(() => {
    if (!editing) return
    const markActive = () => {
      lastActivity.current = Date.now()
    }
    addEventListener('keydown', markActive)
    addEventListener('pointerdown', markActive)
    // Only renew while the person is active, so an abandoned tab lets the lock expire.
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current > IDLE_MS) return
      api(`/contracts/${id}/lock`, { body: {} }).catch((err: Error) => {
        setEditing(false)
        latest.current = saved
        setVersion((v) => v + 1)
        setError(`${err.message} Your unsaved changes were discarded.`)
      })
    }, HEARTBEAT_MS)
    return () => {
      clearInterval(timer)
      removeEventListener('keydown', markActive)
      removeEventListener('pointerdown', markActive)
    }
  }, [editing, id, saved])

  useEffect(() => {
    if (!editing) return
    return () => {
      void api(`/contracts/${id}/lock`, { method: 'DELETE' }).catch(() => undefined)
    }
  }, [editing, id])

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

  function startEditing(takeOver: boolean) {
    void run(async () => {
      await api<LockHolder>(`/contracts/${id}/lock`, { body: { takeOver } })
      lastActivity.current = Date.now()
      setLock(null)
      setNotice('')
      setEditing(true)
    })
  }

  function save() {
    void run(async () => {
      // Re-taking the lock first means a save still works after the lock lapsed from inactivity.
      await api(`/contracts/${id}/lock`, { body: {} })
      await api(`/contracts/${id}/draft`, { method: 'PUT', body: { content: latest.current } })
      setSaved(latest.current)
      setEditing(false)
    })
  }

  function cancel() {
    latest.current = saved
    setVersion((v) => v + 1)
    setEditing(false)
  }

  function upload(file: File) {
    void run(async () => {
      const form = new FormData()
      form.append('file', file)
      const result = await api<{ content: JSONContent; commentsDropped: boolean }>(`/contracts/${id}/upload`, { body: form })
      latest.current = result.content
      setSaved(result.content)
      setVersion((v) => v + 1)
      setNotice(result.commentsDropped ? "Document replaced. Comments in the uploaded file weren't imported." : 'Document replaced.')
    })
  }

  const lockedByOther = lock !== null && lock.userId !== user.id

  return (
    <section className="sheet mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-6 py-4 sm:px-12">
        <span className="text-sm text-ink-muted">
          {editing ? 'Editing. Save to share with your team.' : lockedByOther ? `${lock.name} is editing` : contract.draftContent ? 'Document' : ''}
        </span>
        <div className="flex gap-2">
          {editing ? (
            <>
              <input ref={fileInput} type="file" accept=".docx" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <Button variant="ghost" disabled={busy} onClick={() => fileInput.current?.click()}>Upload .docx</Button>
              <Button variant="outline" disabled={busy} onClick={cancel}>Cancel</Button>
              <Button disabled={busy} onClick={save}>Save</Button>
            </>
          ) : canEdit && lockedByOther ? (
            <Button variant="outline" disabled={busy} onClick={() => startEditing(true)}>Take over</Button>
          ) : canEdit ? (
            <Button disabled={busy} onClick={() => startEditing(false)}>Edit</Button>
          ) : null}
        </div>
      </div>
      {notice && <p className="border-b border-rule bg-muted px-6 py-3 text-sm text-ink sm:px-12">{notice}</p>}
      {error && <p className="border-b border-rule px-6 py-3 text-sm text-destructive sm:px-12">{error}</p>}
      <div className="px-6 sm:px-12">
        {contract.draftContent ? (
          <SimpleEditor
            key={version}
            content={latest.current}
            editable={editing}
            onChange={(content) => {
              latest.current = content
              lastActivity.current = Date.now()
            }}
          />
        ) : (
          <p className="py-12 text-center text-sm text-ink-muted">The other side hasn't sent the contract yet.</p>
        )}
      </div>
    </section>
  )
}

export function ContractPage({ id, user }: { id: string; user: User }) {
  const [contract, setContract] = useState<ContractDetail | null>(null)
  const [error, setError] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [orgName, setOrgName] = useState('')

  async function load() {
    try {
      setContract(await api<ContractDetail>(`/contracts/${id}`))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    void load()
  }, [id, user.name])

  async function act(event: FormEvent, action: () => Promise<void>) {
    event.preventDefault()
    setError('')
    try {
      await action()
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (!contract) return <p className="mx-auto max-w-3xl px-4 py-20 text-sm text-destructive sm:px-6">{error}</p>

  const myParty = contract.parties.find((party) => party.participants.some((p) => p.user.id === user.id))
  const turnParty = contract.parties.find((party) => party.id === contract.currentTurnPartyId)
  const parties = [...contract.parties.filter((p) => p.id === myParty?.id), ...contract.parties.filter((p) => p.id !== myParty?.id)]

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="sheet px-6 py-10 sm:px-12">
        <h2 className="m-0 font-serif text-3xl font-medium leading-tight text-ink sm:text-4xl">{contract.title}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <StatusBadge status={contract.status} />
          {turnParty && (
            <span className={turnParty.id === myParty?.id ? 'font-medium text-action' : 'text-ink-muted'}>
              {turnParty.id === myParty?.id ? 'Your turn' : `Waiting for ${turnParty.orgName}`}
            </span>
          )}
        </div>

        <div className="mt-10 grid gap-10 border-t border-rule pt-8 sm:grid-cols-2 sm:gap-0">
          {parties.map((party, index) => (
            <section key={party.id} className={index === 1 ? 'sm:border-l sm:border-rule sm:pl-8' : 'sm:pr-8'}>
              <h3 className="font-serif text-xl text-ink">{party.orgName}</h3>
              <p className="text-sm text-ink-muted">
                {party.role === 'PROPOSER' ? 'Proposing party' : 'Counterparty'}
                {party.id === myParty?.id && ', your side'}
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {party.participants.map((p) => (
                  <li key={p.id} className="text-ink">
                    {p.user.name ?? p.user.email}
                    {p.user.id === user.id && <span className="text-ink-muted"> (you)</span>}
                  </li>
                ))}
                {party.invites.map((invite) => (
                  <li key={invite.id} className="flex items-center gap-2 text-ink-muted">
                    <span className="truncate">{invite.email}</span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs">Invited</span>
                  </li>
                ))}
              </ul>

              {party.id === myParty?.id && (
                <div className="mt-8 space-y-6">
                  <form
                    className="space-y-2"
                    onSubmit={(e) =>
                      act(e, async () => {
                        await api(`/contracts/${id}/invites`, { body: { email: inviteEmail, name: inviteName } })
                        setInviteEmail('')
                        setInviteName('')
                      })
                    }
                  >
                    <input className={inputClass} type="email" required placeholder="Teammate's email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
                    <div className="flex items-end gap-2">
                      <input className={inputClass} placeholder="Name (optional)" maxLength={200} value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
                      <Button type="submit" variant="outline">Invite</Button>
                    </div>
                  </form>

                  {party.role === 'COUNTERPARTY' && (
                    <form
                      className="flex items-end gap-2"
                      onSubmit={(e) =>
                        act(e, async () => {
                          await api(`/contracts/${id}/org-name`, { method: 'PATCH', body: { orgName } })
                          setOrgName('')
                        })
                      }
                    >
                      <input className={inputClass} required maxLength={200} placeholder="Rename your organisation" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
                      <Button type="submit" variant="outline">Rename</Button>
                    </form>
                  )}
                </div>
              )}
            </section>
          ))}
        </div>

        {error && <p className="mt-8 text-sm text-destructive">{error}</p>}
      </div>
      <DocumentSection
        key={contract.id}
        contract={contract}
        user={user}
        canEdit={contract.status === 'DRAFT' && contract.currentTurnPartyId === myParty?.id}
      />
    </div>
  )
}
