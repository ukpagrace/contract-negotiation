import { useEffect, useState, type ReactNode } from 'react'
import { DropdownMenu } from 'radix-ui'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, type ContractDetail, type User } from '@/lib/api'
import { StatusBadge } from '../Contracts'
import { DocumentSection } from './DocumentSection'
import { PeopleDialog } from './PeopleDialog'
import { Sidebar } from './Sidebar'

export type ViewMode = 'both' | 'theirs'

const viewLabels: Record<ViewMode, string> = {
  both: "Both sides' changes",
  theirs: "Other party's changes only",
}

function Menu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="outline">
          {label} <ChevronDown />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="sheet z-50 min-w-64 p-1 text-sm">
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

const menuItemClass = 'flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-ink outline-none data-[highlighted]:bg-muted'

export function ContractPage({ id, user }: { id: string; user: User }) {
  const [contract, setContract] = useState<ContractDetail | null>(null)
  const [error, setError] = useState('')
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [view, setView] = useState<ViewMode>('both')

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

  if (!contract) return <p className="px-6 py-20 text-sm text-destructive">{error}</p>

  const myParty = contract.parties.find((party) => party.participants.some((p) => p.user.id === user.id))
  const turnParty = contract.parties.find((party) => party.id === contract.currentTurnPartyId)

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-y border-rule bg-paper px-6 py-4">
        <div className="min-w-0">
          <h2 className="m-0 truncate font-serif text-2xl font-medium text-ink">{contract.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={contract.status} />
            {turnParty && (
              <span className={turnParty.id === myParty?.id ? 'font-medium text-action' : 'text-ink-muted'}>
                {turnParty.id === myParty?.id ? 'Your turn' : `Waiting for ${turnParty.orgName}`}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setPeopleOpen(true)}>People</Button>
          <Menu label="History">
            <p className="px-3 py-2 text-ink-muted">No versions yet. A version is saved each time the contract is sent.</p>
          </Menu>
          <Menu label="View">
            <DropdownMenu.RadioGroup value={view} onValueChange={(value) => setView(value as ViewMode)}>
              {(Object.keys(viewLabels) as ViewMode[]).map((mode) => (
                <DropdownMenu.RadioItem key={mode} value={mode} className={menuItemClass}>
                  <span className="w-3 text-action">{view === mode && '●'}</span>
                  {viewLabels[mode]}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </Menu>
        </div>
      </header>

      <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <main className="min-w-0 px-4 py-8 sm:px-8">
          <div className="mx-auto max-w-3xl">
            <DocumentSection
              key={contract.id}
              contract={contract}
              user={user}
              canEdit={contract.status === 'DRAFT' && contract.currentTurnPartyId === myParty?.id}
            />
          </div>
        </main>
        <Sidebar />
      </div>

      <PeopleDialog
        contract={contract}
        user={user}
        myParty={myParty}
        open={peopleOpen}
        onOpenChange={setPeopleOpen}
        onChanged={load}
      />
    </div>
  )
}
