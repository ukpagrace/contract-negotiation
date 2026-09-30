import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api, type ChatItem, type CommentItem, type ThreadItem, type Visibility } from '@/lib/api'

// What a new thread is attached to, before its first comment is posted.
export type ThreadTarget = { changeId: string; quote: string } | { anchor: { quote: string; prefix: string; suffix: string } }

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const snippet = (text: string) => (text.length > 120 ? `${text.slice(0, 120)}…` : text)

function InternalTag() {
  return <span className="rounded-sm bg-internal/10 px-1.5 py-0.5 text-[11px] font-medium text-internal">Internal</span>
}

function Composer({
  withVisibility,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  withVisibility: boolean
  placeholder?: string
  submitLabel: string
  onSubmit: (body: string, visibility: Visibility) => Promise<void>
  onCancel?: () => void
}) {
  const [visibility, setVisibility] = useState<Visibility>('INTERNAL')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const internal = visibility === 'INTERNAL'

  async function submit() {
    if (!body.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await onSubmit(body, visibility)
      setBody('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`rounded-md p-2 ${withVisibility ? (internal ? 'border-2 border-internal/60 bg-internal/5' : 'border-2 border-action/60 bg-action/5') : 'border border-rule'}`}>
      {withVisibility && (
        <>
          <div role="radiogroup" aria-label="Who can see this" className="flex gap-1.5 text-xs font-semibold">
            {(['INTERNAL', 'SHARED'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={visibility === mode}
                onClick={() => setVisibility(mode)}
                className={`flex-1 rounded-md border-2 px-2 py-1.5 ${
                  visibility === mode
                    ? mode === 'INTERNAL' ? 'border-internal bg-internal text-white' : 'border-action bg-action text-white'
                    : 'border-rule text-ink-muted hover:border-ink-muted hover:text-ink'
                }`}
              >
                {mode === 'INTERNAL' ? 'Internal' : 'Shared'}
              </button>
            ))}
          </div>
          <p className={`mt-2 mb-2 text-xs font-bold ${internal ? 'text-internal' : 'text-action'}`}>
            {internal ? 'Only your team will see this.' : 'Both parties will see this.'}
          </p>
        </>
      )}
      <textarea
        className="block w-full resize-none bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted/70"
        rows={3}
        maxLength={5000}
        autoFocus={Boolean(onCancel)}
        placeholder={placeholder ?? (internal ? 'Message your team' : 'Message both parties')}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        {onCancel && <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>}
        <Button size="sm" disabled={busy || !body.trim()} onClick={() => void submit()}>{submitLabel}</Button>
      </div>
    </div>
  )
}

function Message({ item, own, onEdit, onDelete }: {
  item: CommentItem
  own: boolean
  onEdit: (body: string) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirmDelete'>('view')
  const [draft, setDraft] = useState(item.body)
  const [error, setError] = useState('')

  async function run(action: () => Promise<void>) {
    setError('')
    try {
      await action()
      setMode('view')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const header = (
    <span className="block text-xs text-ink-muted">
      <span className="font-medium text-ink">{own ? 'You' : item.authorName}</span> · {formatTime(item.createdAt)}
      {item.editedAt && !item.deletedAt && ' (edited)'}
    </span>
  )

  if (item.deletedAt) {
    return (
      <div>
        {header}
        <p className="mt-0.5 text-sm text-ink-muted italic">Message deleted</p>
      </div>
    )
  }

  return (
    <div>
      {header}
      {mode === 'edit' ? (
        <div className="mt-1">
          <textarea
            className="block w-full resize-none rounded-sm border border-rule p-1.5 text-sm text-ink outline-none focus:border-action"
            rows={3}
            maxLength={5000}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="mt-1 flex gap-2">
            <Button size="sm" disabled={!draft.trim()} onClick={() => void run(() => onEdit(draft))}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => setMode('view')}>Cancel</Button>
          </div>
        </div>
      ) : (
        <p className="mt-0.5 text-sm whitespace-pre-wrap break-words text-ink">{item.body}</p>
      )}
      {own && mode === 'view' && (
        <div className="mt-1 flex gap-3 text-xs text-ink-muted">
          <button className="hover:text-ink" onClick={() => { setDraft(item.body); setMode('edit') }}>Edit</button>
          <button className="hover:text-destructive" onClick={() => setMode('confirmDelete')}>Delete</button>
        </div>
      )}
      {mode === 'confirmDelete' && (
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className="text-ink-muted">Delete this message?</span>
          <Button size="sm" variant="destructive" onClick={() => void run(onDelete)}>Delete</Button>
          <Button size="sm" variant="outline" onClick={() => setMode('view')}>Cancel</Button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}

interface CommentsPanelProps {
  contractId: string
  userId: string
  threads: ThreadItem[]
  target: ThreadTarget | null
  isOutdated: (thread: ThreadItem) => boolean
  selectedId: string | null
  onSelect: (thread: ThreadItem) => void
  onCancelTarget: () => void
  onChanged: () => Promise<void>
}

export function CommentsPanel({ contractId, userId, threads, target, isOutdated, selectedId, onSelect, onCancelTarget, onChanged }: CommentsPanelProps) {
  const [showResolved, setShowResolved] = useState(false)
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const selectedRef = useRef<HTMLLIElement>(null)
  const open = threads.filter((thread) => thread.status === 'OPEN')
  const resolved = threads.filter((thread) => thread.status === 'RESOLVED')

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  async function call(path: string, method: string, body?: object) {
    await api(`/contracts/${contractId}/${path}`, { method, body })
    await onChanged()
  }

  const card = (thread: ThreadItem) => {
    const selected = thread.id === selectedId
    const outdated = thread.status === 'OPEN' && isOutdated(thread)
    return (
      <li
        key={thread.id}
        ref={selected ? selectedRef : undefined}
        className={`rounded-md border p-3 ${selected ? 'border-action bg-muted' : 'border-rule'}`}
      >
        <button className="block w-full text-left" onClick={() => onSelect(thread)}>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
            {thread.prefix === null ? 'On a change' : 'On text'}
            {thread.visibility === 'INTERNAL' && <InternalTag />}
            {outdated && <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">Outdated</span>}
          </span>
          {thread.quote && (
            <span className={`mt-1 block border-l-2 pl-2 font-serif text-base break-words ${outdated ? 'border-rule text-ink-muted' : 'border-yellow-500 text-ink'}`}>
              {snippet(thread.quote)}
            </span>
          )}
        </button>
        <div className="mt-3 space-y-3">
          {thread.comments.map((comment) => (
            <Message
              key={comment.id}
              item={comment}
              own={comment.authorUserId === userId}
              onEdit={(body) => call(`comments/${comment.id}`, 'PATCH', { body })}
              onDelete={() => call(`comments/${comment.id}`, 'DELETE')}
            />
          ))}
        </div>
        {thread.status === 'RESOLVED' ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
            <span>Resolved by {thread.resolvedByName} · {thread.resolvedAt && formatTime(thread.resolvedAt)}</span>
            <Button size="sm" variant="outline" onClick={() => void call(`threads/${thread.id}`, 'PATCH', { status: 'OPEN' })}>Reopen</Button>
          </div>
        ) : replyingTo === thread.id ? (
          <div className="mt-3">
            <Composer
              withVisibility={false}
              placeholder={thread.visibility === 'INTERNAL' ? 'Reply to your team' : 'Reply to both parties'}
              submitLabel="Reply"
              onSubmit={async (body) => {
                await call(`threads/${thread.id}/comments`, 'POST', { body })
                setReplyingTo(null)
              }}
              onCancel={() => setReplyingTo(null)}
            />
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setReplyingTo(thread.id)}>Reply</Button>
            <Button size="sm" variant="ghost" onClick={() => void call(`threads/${thread.id}`, 'PATCH', { status: 'RESOLVED' })}>Resolve</Button>
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="space-y-4">
      {target && (
        <div>
          <p className="mb-2 text-xs text-ink-muted">
            New comment on {'changeId' in target ? 'change' : 'text'}:{' '}
            <span className="font-serif text-sm text-ink">“{snippet('changeId' in target ? target.quote : target.anchor.quote)}”</span>
          </p>
          <Composer
            withVisibility
            submitLabel="Comment"
            onSubmit={async (body, visibility) => {
              await call('threads', 'POST', 'changeId' in target
                ? { visibility, body, changeId: target.changeId }
                : { visibility, body, anchor: target.anchor })
              onCancelTarget()
            }}
            onCancel={onCancelTarget}
          />
        </div>
      )}
      {open.length === 0 && !target && (
        <p className="text-sm leading-relaxed text-ink-muted">
          {resolved.length ? 'No open comments.' : 'No comments yet.'} Select text in the document, or use Comment on a change, to start a thread.
        </p>
      )}
      <ul className="space-y-2">{open.map(card)}</ul>
      {resolved.length > 0 && (
        <div>
          <button className="text-sm text-ink-muted hover:text-ink" onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? '▾' : '▸'} Resolved ({resolved.length})
          </button>
          {showResolved && <ul className="mt-2 space-y-2 opacity-80">{resolved.map(card)}</ul>}
        </div>
      )}
    </div>
  )
}

export function ChatPanel({ contractId, userId, messages, onChanged }: {
  contractId: string
  userId: string
  messages: ChatItem[]
  onChanged: () => Promise<void>
}) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length])

  async function call(path: string, method: string, body?: object) {
    await api(`/contracts/${contractId}/${path}`, { method, body })
    await onChanged()
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex-1 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm leading-relaxed text-ink-muted">No messages yet. Chat with your team or with both sides about the whole contract.</p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`rounded-md p-2.5 ${message.visibility === 'INTERNAL' ? 'border-l-2 border-internal bg-internal/5' : 'bg-muted'}`}
          >
            <div className="mb-1 flex items-center gap-1.5 text-[11px] text-ink-muted">
              {message.orgName}
              {message.visibility === 'INTERNAL' && <InternalTag />}
            </div>
            <Message
              item={message}
              own={message.authorUserId === userId}
              onEdit={(body) => call(`chat/${message.id}`, 'PATCH', { body })}
              onDelete={() => call(`chat/${message.id}`, 'DELETE')}
            />
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="sticky bottom-0 bg-paper pb-1">
        <Composer withVisibility submitLabel="Send" onSubmit={(body, visibility) => call('chat', 'POST', { visibility, body })} />
      </div>
    </div>
  )
}
