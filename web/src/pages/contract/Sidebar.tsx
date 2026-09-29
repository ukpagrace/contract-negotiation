import { useState } from 'react'

const tabs = ['Changes', 'Comments', 'Chat', 'AI'] as const
type Tab = (typeof tabs)[number]

const emptyStates: Record<Tab, string> = {
  Changes: 'No changes yet. Edits are tracked once the contract has been sent.',
  Comments: 'No comments yet. Select text in the document to start a thread.',
  Chat: 'No messages yet. Chat with your team or with both sides about the whole contract.',
  AI: 'Ask questions about the document or get a plain-language summary of the changes.',
}

export function Sidebar() {
  const [active, setActive] = useState<Tab>('Changes')

  return (
    <aside className="flex min-h-80 flex-col border-t border-rule bg-paper lg:sticky lg:top-0 lg:h-svh lg:border-t-0 lg:border-l">
      <div role="tablist" aria-label="Sidebar" className="flex border-b border-rule px-2">
        {tabs.map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={active === tab}
            onClick={() => setActive(tab)}
            className={`-mb-px border-b-2 px-3 py-3 text-sm ${
              active === tab ? 'border-action font-medium text-ink' : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={active} className="flex-1 overflow-y-auto p-5">
        <p className="text-sm leading-relaxed text-ink-muted">{emptyStates[active]}</p>
      </div>
    </aside>
  )
}
