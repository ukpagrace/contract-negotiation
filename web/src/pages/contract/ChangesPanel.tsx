import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import type { ChangeItem } from '@/lib/api'

export type ChangeAction = 'accept' | 'reject' | 'withdraw'

interface ChangesPanelProps {
  changes: ChangeItem[]
  tracking: boolean
  myPartyId: string | undefined
  myTurn: boolean
  selectedId: string | null
  busyId: string | null
  error: string
  onSelect: (id: string) => void
  onAction: (id: string, action: ChangeAction) => void
}

const snippet = (text: string) => (text.length > 120 ? `${text.slice(0, 120)}…` : text)

export function ChangesPanel({ changes, tracking, myPartyId, myTurn, selectedId, busyId, error, onSelect, onAction }: ChangesPanelProps) {
  const selectedRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  if (!tracking) {
    return <p className="text-sm leading-relaxed text-ink-muted">Changes are tracked once the contract has been sent.</p>
  }
  if (changes.length === 0) {
    return <p className="text-sm leading-relaxed text-ink-muted">No pending changes.</p>
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ul className="space-y-2">
        {changes.map((change) => {
          const own = change.authorPartyId === myPartyId
          const selected = change.id === selectedId
          return (
            <li
              key={change.id}
              ref={selected ? selectedRef : undefined}
              className={`rounded-md border p-3 ${selected ? 'border-action bg-muted' : 'border-rule'}`}
            >
              <button
                className="block w-full text-left"
                onClick={() => {
                  onSelect(change.id)
                  document
                    .querySelector(`.ProseMirror [data-change-id="${CSS.escape(change.id)}"]`)
                    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                }}
              >
                <span className="block text-xs text-ink-muted">
                  {own ? 'You' : change.authorName} ({change.authorOrg}) {change.type === 'INSERT' ? 'added' : 'removed'}
                </span>
                <span
                  className={`mt-1 block font-serif text-base break-words ${
                    change.type === 'INSERT' ? 'text-insert underline underline-offset-2' : 'text-delete line-through'
                  }`}
                >
                  {snippet(change.text)}
                </span>
              </button>
              {myTurn && (
                <div className="mt-3 flex gap-2">
                  {own ? (
                    <Button size="sm" variant="outline" disabled={busyId !== null} onClick={() => onAction(change.id, 'withdraw')}>
                      Withdraw
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" disabled={busyId !== null} onClick={() => onAction(change.id, 'accept')}>
                        Accept
                      </Button>
                      <Button size="sm" variant="outline" disabled={busyId !== null} onClick={() => onAction(change.id, 'reject')}>
                        Reject
                      </Button>
                    </>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
