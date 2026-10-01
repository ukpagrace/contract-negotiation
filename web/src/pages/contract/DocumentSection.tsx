import { useEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/react'
import { SimpleEditor } from '@/components/tiptap-templates/simple/simple-editor'
import { Button } from '@/components/ui/button'
import { plainTextOf, type AnchoredThread } from '@/components/tiptap-ui/redlining/commentAnchors'
import { spotOffsets } from '@/components/tiptap-ui/redlining/signatureSpot'
import { api, type Anchor, type ContractDetail, type LockHolder, type PartyRole, type User } from '@/lib/api'

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
  selectedChangeId: string | null
  onSelectChange: (changeId: string) => void
  onSaved: () => void
  // Bumped by live updates whenever the edit lock changes hands.
  lockSignal: number
  anchors: AnchoredThread[]
  onAnchorsFound: (threadIds: string[]) => void
  selectedThreadId: string | null
  onSelectThread: (threadId: string) => void
  onComment: (anchor: Anchor) => void
  // Placing mode (proposer's Ready to sign): only signature spots can be put down; Done also marks ready.
  placing: boolean
  onPlacingEnd: () => void
}

export function DocumentSection(props: DocumentSectionProps) {
  const { contract, user, canEdit, myPartyId, view, selectedChangeId, onSelectChange, onSaved, lockSignal, placing } = props
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

  const lockedByOther = lock !== null && lock.userId !== user.id

  const orgOf = (role: PartyRole) => contract.parties.find((party) => party.role === role)?.orgName ?? ''
  const spotLabels = { PROPOSER: `${orgOf('PROPOSER')} signs here`, COUNTERPARTY: `${orgOf('COUNTERPARTY')} signs here` }
  const [spots, setSpots] = useState(() => spotOffsets(saved))
  const nextSpot: PartyRole | null = spots.PROPOSER === undefined ? 'PROPOSER' : spots.COUNTERPARTY === undefined ? 'COUNTERPARTY' : null

  function finishPlacing() {
    void run(async () => {
      const { PROPOSER, COUNTERPARTY } = spotOffsets(latest.current)
      await api(`/contracts/${id}/signature-spots`, {
        method: 'PUT',
        body: { offsets: { PROPOSER, COUNTERPARTY }, baseText: plainTextOf(latest.current) },
      })
      await api(`/contracts/${id}/ready`, { body: { placement: 'SPOTS' } })
      props.onPlacingEnd()
    })
  }

  function cancelPlacing() {
    latest.current = saved
    setSpots(spotOffsets(saved))
    setVersion((v) => v + 1)
    setError('')
    props.onPlacingEnd()
  }

  function discard(message: string) {
    setEditing(false)
    latest.current = saved
    setVersion((v) => v + 1)
    setError(`${message} Your unsaved changes were discarded.`)
  }

  // Re-checked on every lock event. A lock that lapses from inactivity sends no event, so while
  // a teammate holds it we also look again now and then.
  useEffect(() => {
    const check = () =>
      api<LockHolder | null>(`/contracts/${id}/lock`).then((holder) => {
        if (!editing) setLock(holder)
        else if (holder && holder.userId !== user.id) discard(`${holder.name} is editing.`)
      }, () => undefined)
    void check()
    if (!lockedByOther) return
    const timer = setInterval(check, 30_000)
    return () => clearInterval(timer)
  }, [editing, id, lockSignal, lockedByOther, saved])

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
      api(`/contracts/${id}/lock`, { body: {} }).catch((err: Error) => discard(err.message))
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
      onSaved()
      setEditing(false)
    })
  }

  // While editing, only text that's already saved can be commented on; the server checks the same.
  function comment(anchor: Anchor) {
    if (editing) {
      const savedText = plainTextOf(saved)
      if (!savedText.includes(anchor.quote)) {
        setError('Save your edits first, then comment on the new text.')
        return
      }
      // The words around it may be unsaved edits; leave them out.
      if (!savedText.includes(anchor.prefix + anchor.quote + anchor.suffix)) {
        anchor = { quote: anchor.quote, prefix: '', suffix: '' }
      }
    }
    setError('')
    props.onComment(anchor)
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
      const done = tracking ? 'Uploaded. Differences from the current text are shown as your tracked changes.' : 'Document replaced.'
      setNotice(result.commentsDropped ? `${done} Comments in the uploaded file weren't imported.` : done)
      onSaved()
    })
  }

  return (
    <section
      className="sheet"
      onClick={(event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-change-id], [data-thread-id]')
        if (target?.dataset.threadId) props.onSelectThread(target.dataset.threadId)
        else if (target?.dataset.changeId) onSelectChange(target.dataset.changeId)
      }}
    >
      {selectedChangeId && (
        <style>{`.ProseMirror [data-change-id="${CSS.escape(selectedChangeId)}"] { outline: 2px solid var(--color-action); outline-offset: 1px; border-radius: 2px; }`}</style>
      )}
      {props.selectedThreadId && (
        <style>{`.ProseMirror [data-thread-id="${CSS.escape(props.selectedThreadId)}"] { background: rgb(250 204 21 / 0.6); }`}</style>
      )}
      <div
        className={`flex flex-wrap items-center justify-between gap-3 border-b border-rule px-6 py-4 sm:px-12 ${placing ? 'sticky top-0 z-10 bg-muted' : ''}`}
      >
        <span className={placing ? 'text-sm font-medium text-ink' : 'text-sm text-ink-muted'}>
          {placing
            ? nextSpot
              ? `Click where ${orgOf(nextSpot)} signs.`
              : 'Both spots placed. Click a spot to move it.'
            : editing ? (tracking ? 'Editing. Your changes are tracked.' : 'Editing. Save to share with your team.') : lockedByOther ? `${lock.name} is editing` : contract.draftContent ? 'Document' : ''}
        </span>
        <div className="flex gap-2">
          {placing ? (
            <>
              <Button variant="outline" disabled={busy} onClick={cancelPlacing}>Cancel</Button>
              <Button disabled={busy || nextSpot !== null} onClick={finishPlacing}>Done</Button>
            </>
          ) : editing ? (
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
      <div className={`px-6 sm:px-12 ${view === 'theirs' ? 'redline-theirs' : ''}`}>
        {contract.draftContent ? (
          <SimpleEditor
            key={version}
            content={latest.current}
            editable={editing}
            trackAsPartyId={tracking ? myPartyId : undefined}
            anchors={props.anchors}
            onAnchorsFound={props.onAnchorsFound}
            onComment={comment}
            readingAction={
              !canEdit || placing ? undefined : lockedByOther ? (
                <span className="comment-bubble-muted">{lock.name} is editing</span>
              ) : (
                <button type="button" onClick={() => startEditing(false)}>Edit</button>
              )
            }
            spotLabels={spotLabels}
            placingRole={placing ? nextSpot : undefined}
            onChange={(content) => {
              latest.current = content
              lastActivity.current = Date.now()
              setSpots(spotOffsets(content))
            }}
          />
        ) : (
          <p className="py-12 text-center text-sm text-ink-muted">The other side hasn't sent the contract yet.</p>
        )}
      </div>
    </section>
  )
}
