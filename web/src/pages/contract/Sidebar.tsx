import type { ReactNode } from 'react'

const tabs = ['Changes', 'Comments', 'Chat', 'AI'] as const
export type Tab = (typeof tabs)[number]


interface SidebarProps {
  active: Tab
  onActiveChange: (tab: Tab) => void
  panels: Record<Tab, ReactNode>
}

export function Sidebar({ active, onActiveChange, panels }: SidebarProps) {

  return (
    <aside className="flex min-h-80 flex-col border-t border-rule bg-paper lg:sticky lg:top-0 lg:h-svh lg:border-t-0 lg:border-l">
      <div role="tablist" aria-label="Sidebar" className="flex border-b border-rule px-2">
        {tabs.map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={active === tab}
            onClick={() => onActiveChange(tab)}
            className={`-mb-px border-b-2 px-3 py-3 text-sm ${
              active === tab ? 'border-action font-medium text-ink' : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={active} className="flex-1 overflow-y-auto p-5">
        {panels[active]}
      </div>
    </aside>
  )
}
