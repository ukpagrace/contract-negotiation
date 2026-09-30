import { useEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/react'
import { SimpleEditor } from '@/components/tiptap-templates/simple/simple-editor'
import { Button } from '@/components/ui/button'
import { api, type ContractDetail, type LockHolder, type User } from '@/lib/api'

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }
const HEARTBEAT_MS = 20_000
const IDLE_MS = 60_000

export type ViewMode = 'both' | 'theirs'

// Only rules for the viewer's own changes differ between views, and those depend on their side's id.
export function ViewStyles({ partyId }: { partyId: string }) {
  const own = (flag: string) => `.redline-theirs span[${flag}][data-author-party="${partyId}"]`
  return (
    <style>{`
      ${own('data-tracked-insertion')} { color: inherit; text-decoration: underline dotted var(--color-ink-muted); }
      ${own('data-tracked-deletion')} { font-size: 0; }
      ${own('data-tracked-deletion')}::before {
        content: ''; display: inline-block; width: 2px; height: 1.1rem; margin: 0 1px;
        background: var(--color-delete); vertical-align: text-bottom;
      }
    `}</style>
  )
}

interface DocumentSectionProps {
  contract: ContractDetail
  user: User
  canEdit: boolean
  myPartyId: string | undefined
  view: ViewMode
}

export function DocumentSection({ contract, user, canEdit, myPartyId, view }: DocumentSectionProps) {
  const tracking = contract.status !== 'DRAFT'
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
    <section className="sheet">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-6 py-4 sm:px-12">
        <span className="text-sm text-ink-muted">
          {editing ? (tracking ? 'Editing. Your changes are tracked.' : 'Editing. Save to share with your team.') : lockedByOther ? `${lock.name} is editing` : contract.draftContent ? 'Document' : ''}
        </span>
        <div className="flex gap-2">
          {editing ? (
            <>
              <input ref={fileInput} type="file" accept=".docx" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              {!tracking && (
                <Button variant="ghost" disabled={busy} onClick={() => fileInput.current?.click()}>Upload .docx</Button>
              )}
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
      <div className={`px-6 sm:px-12 ${view === 'theirs' ? 'redline-theirs' : ''}`}>
        {contract.draftContent ? (
          <SimpleEditor
            key={version}
            content={latest.current}
            editable={editing}
            trackAsPartyId={tracking ? myPartyId : undefined}
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
