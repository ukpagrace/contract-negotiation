import { useEffect, useRef, useState } from 'react'
import { MessageCircleQuestion, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, type ChangeItem } from '@/lib/api'

const snippet = (text: string) => (text.length > 120 ? `${text.slice(0, 120)}…` : text)

// A result that is loading, failed, or ready; shown under the thing that asked for it.
type Answer = { status: 'loading' } | { status: 'error'; message: string } | { status: 'done'; text: string }

function AnswerBox({ answer }: { answer: Answer | undefined }) {
  if (!answer) return null
  if (answer.status === 'loading') return <p className="mt-2 text-sm text-ink-muted italic">Thinking…</p>
  if (answer.status === 'error') return <p className="mt-2 text-sm text-destructive">{answer.message}</p>
  return <p className="mt-2 rounded-md bg-muted p-3 text-sm leading-relaxed whitespace-pre-wrap text-ink">{answer.text}</p>
}

export function AiPanel({ contractId, changes, myPartyId }: { contractId: string; changes: ChangeItem[]; myPartyId: string | undefined }) {
  const [summary, setSummary] = useState<Answer>()
  const [explained, setExplained] = useState<Record<string, Answer>>({})

  async function load(path: string, body: object, set: (answer: Answer) => void) {
    set({ status: 'loading' })
    try {
      const { text } = await api<{ text: string }>(`/contracts/${contractId}/ai/${path}`, { body })
      set({ status: 'done', text })
    } catch (err) {
      set({ status: 'error', message: (err as Error).message })
    }
  }

  const explain = (changeId: string) =>
    void load('explain', { changeId }, (answer) => setExplained((all) => ({ ...all, [changeId]: answer })))

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-ink-muted">
        Plain-language explanations of the pending changes. The AI sees the document and its changes, never comments or chat. It can
        make mistakes, so check anything important.
      </p>
      <div>
        <Button size="sm" disabled={summary?.status === 'loading' || changes.length === 0} onClick={() => void load('summary', {}, setSummary)}>
          Explain all changes
        </Button>
        <AnswerBox answer={summary} />
      </div>
      {changes.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-muted">No pending changes to explain.</p>
      ) : (
        <ul className="space-y-2">
          {changes.map((change) => (
            <li key={change.id} className="rounded-md border border-rule p-3">
              <span className="block text-xs text-ink-muted">
                {change.authorPartyId === myPartyId ? 'You' : change.authorName} ({change.authorOrg}) {change.type === 'INSERT' ? 'added' : 'removed'}
              </span>
              <span
                className={`mt-1 block font-serif text-base break-words ${
                  change.type === 'INSERT' ? 'text-insert underline underline-offset-2' : 'text-delete line-through'
                }`}
              >
                {snippet(change.text)}
              </span>
              <Button className="mt-2" size="sm" variant="outline" disabled={explained[change.id]?.status === 'loading'} onClick={() => explain(change.id)}>
                Explain
              </Button>
              <AnswerBox answer={explained[change.id]} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type Turn = { role: 'user' | 'assistant'; content: string }

// Floating Ask AI chat. The conversation lives only in this page and is gone on refresh.
export function AskAi({ contractId }: { contractId: string }) {
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [turns.length, busy, open])

  async function send() {
    const content = question.trim()
    if (!content || busy) return
    const asked: Turn[] = [...turns, { role: 'user', content }]
    setTurns(asked)
    setQuestion('')
    setBusy(true)
    setError('')
    try {
      const { text } = await api<{ text: string }>(`/contracts/${contractId}/ai/ask`, { body: { turns: asked.slice(-39) } })
      setTurns([...asked, { role: 'assistant', content: text }])
    } catch (err) {
      // Take the question back so it can be sent again.
      setTurns(turns)
      setQuestion(content)
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Sits left of the sidebar on wide screens, so it doesn't cover the chat box at the sidebar's foot.
  const corner = 'fixed right-4 bottom-4 z-40 lg:right-[calc(22rem+1.5rem)]'

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`${corner} flex items-center gap-2 rounded-full bg-action px-4 py-3 text-sm font-medium text-white shadow-lg hover:opacity-90`}
      >
        <MessageCircleQuestion size={18} /> Ask AI
      </button>
    )
  }

  return (
    <section aria-label="Ask AI" className={`${corner} sheet flex h-[32rem] max-h-[80vh] w-[min(24rem,calc(100vw-2rem))] flex-col`}>
      <header className="flex items-center justify-between border-b border-rule px-4 py-3">
        <div>
          <h3 className="m-0 text-sm font-medium text-ink">Ask AI about this contract</h3>
          <p className="m-0 text-[11px] text-ink-muted">Sees the document and changes only. Can make mistakes.</p>
        </div>
        <button aria-label="Close" className="text-ink-muted hover:text-ink" onClick={() => setOpen(false)}>
          <X size={18} />
        </button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {turns.length === 0 && (
          <p className="text-sm leading-relaxed text-ink-muted">Ask anything about the contract, e.g. "When do we have to pay?" or "What happens if we end it early?"</p>
        )}
        {turns.map((turn, i) => (
          <p
            key={i}
            className={`rounded-md p-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              turn.role === 'user' ? 'ml-8 bg-action text-white' : 'mr-8 bg-muted text-ink'
            }`}
          >
            {turn.content}
          </p>
        ))}
        {busy && <p className="mr-8 text-sm text-ink-muted italic">Thinking…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div ref={endRef} />
      </div>
      <div className="border-t border-rule p-3">
        <textarea
          className="block w-full resize-none rounded-md border border-rule p-2 text-sm text-ink outline-none focus:border-action"
          rows={2}
          maxLength={4000}
          autoFocus
          placeholder="Ask a question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <div className="mt-2 flex justify-end">
          <Button size="sm" disabled={busy || !question.trim()} onClick={() => void send()}>Ask</Button>
        </div>
      </div>
    </section>
  )
}
