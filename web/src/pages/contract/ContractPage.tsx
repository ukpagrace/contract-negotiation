import { useEffect, useState, type ReactNode } from 'react'
import { DropdownMenu } from 'radix-ui'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { JSONContent } from '@tiptap/react'
import { SimpleEditor } from '@/components/tiptap-templates/simple/simple-editor'
import { api, type ContractDetail, type User, type VersionSummary } from '@/lib/api'
import { StatusBadge } from '../Contracts'
import { DocumentSection, ViewStyles, type ViewMode } from './DocumentSection'
import { Modal, PeopleDialog } from './PeopleDialog'
import { Sidebar } from './Sidebar'

const viewLabels: Record<ViewMode, string> = {
  both: "Both sides' changes",
  theirs: "Other party's changes only",
}

function Menu({ label, children, onOpen }: { label: string; children: ReactNode; onOpen?: () => void }) {
  return (
    <DropdownMenu.Root onOpenChange={(open) => open && onOpen?.()}>
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

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

const menuItemClass = 'flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-ink outline-none data-[highlighted]:bg-muted'

export function ContractPage({ id, user }: { id: string; user: User }) {
  const [contract, setContract] = useState<ContractDetail | null>(null)
  const [error, setError] = useState('')
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [view, setView] = useState<ViewMode>('both')
  const [versions, setVersions] = useState<VersionSummary[] | null>(null)
  const [viewing, setViewing] = useState<(VersionSummary & { content: JSONContent }) | null>(null)
  const [sendOpen, setSendOpen] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sending, setSending] = useState(false)

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

  const myTurn = contract !== null && contract.currentTurnPartyId !== null && contract.parties.some(
    (party) => party.id === contract.currentTurnPartyId && party.participants.some((p) => p.user.id === user.id),
  )

  // Picks up the other side sending it back; live updates replace this in Phase 6.
  useEffect(() => {
    if (!contract || myTurn) return
    const timer = setInterval(() => void load(), 15_000)
    return () => clearInterval(timer)
  }, [contract?.currentTurnPartyId, myTurn])

  async function openVersion(version: VersionSummary) {
    const { content } = await api<{ content: JSONContent }>(`/contracts/${id}/versions/${version.versionNumber}`)
    setViewing({ ...version, content })
  }

  async function send() {
    setSending(true)
    setSendError('')
    try {
      await api(`/contracts/${id}/send`, { method: 'POST' })
      setSendOpen(false)
      setVersions(null)
      await load()
    } catch (err) {
      setSendError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  if (!contract) return <p className="px-6 py-20 text-sm text-destructive">{error}</p>

  const myParty = contract.parties.find((party) => party.participants.some((p) => p.user.id === user.id))
  const turnParty = contract.parties.find((party) => party.id === contract.currentTurnPartyId)
  const otherParty = contract.parties.find((party) => party.id !== myParty?.id)
  const canSend = myTurn && contract.status !== 'READY_TO_SIGN' && contract.status !== 'SIGNED'

  return (
    <div className="flex flex-1 flex-col">
      {myParty && <ViewStyles partyId={myParty.id} />}
      <header className="flex flex-wrap items-center justify-between gap-4 border-y border-rule bg-paper px-6 py-4">
        <div className="min-w-0">
          <h2 className="m-0 truncate font-serif text-2xl font-medium text-ink">{contract.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={contract.status} />
            {turnParty && (
              <span className={myTurn ? 'font-medium text-action' : 'text-ink-muted'}>
                {myTurn ? 'Your turn' : `Waiting for ${turnParty.orgName} to respond`}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setPeopleOpen(true)}>People</Button>
          <Menu label="History" onOpen={() => void api<VersionSummary[]>(`/contracts/${id}/versions`).then(setVersions)}>
            {versions?.length === 0 && (
              <p className="px-3 py-2 text-ink-muted">No versions yet. A version is saved each time the contract is sent.</p>
            )}
            {versions?.map((version) => (
              <DropdownMenu.Item key={version.versionNumber} className={`${menuItemClass} flex-col items-start gap-0`} onSelect={() => void openVersion(version)}>
                <span className="font-medium">Version {version.versionNumber}</span>
                <span className="text-xs text-ink-muted">
                  Sent by {version.sentByParty.orgName} on {formatDate(version.sentAt)}
                </span>
              </DropdownMenu.Item>
            ))}
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
          {canSend && (
            <Button
              onClick={() => {
                setSendError('')
                setSendOpen(true)
              }}
            >
              Send to {otherParty?.orgName}
            </Button>
          )}
        </div>
      </header>

      <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <main className="min-w-0 px-4 py-8 sm:px-8">
          <div className="mx-auto max-w-3xl">
            {viewing && (
              <section className="sheet">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-muted px-6 py-4 sm:px-12">
                  <span className="text-sm text-ink">
                    Viewing version {viewing.versionNumber}, sent by {viewing.sentByParty.orgName} on {formatDate(viewing.sentAt)}
                  </span>
                  <Button variant="outline" onClick={() => setViewing(null)}>Back to current</Button>
                </div>
                <div className={`px-6 sm:px-12 ${view === 'theirs' ? 'redline-theirs' : ''}`}>
                  <SimpleEditor key={viewing.versionNumber} content={viewing.content} editable={false} />
                </div>
              </section>
            )}
            <div className={viewing ? 'hidden' : undefined}>
              <DocumentSection
                key={`${contract.id}-${contract.currentTurnPartyId}`}
                contract={contract}
                user={user}
                canEdit={canSend}
                myPartyId={myParty?.id}
                view={view}
              />
            </div>
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

      <Modal title={`Send to ${otherParty?.orgName}?`} open={sendOpen} onOpenChange={setSendOpen}>
        <p className="text-sm leading-relaxed text-ink-muted">
          {otherParty?.orgName} will be emailed and it becomes their turn. Your side can still read, comment and chat, but can't edit
          until they send it back.
        </p>
        {sendError && <p className="mt-4 text-sm text-destructive">{sendError}</p>}
        <div className="mt-8 flex gap-2">
          <Button size="lg" disabled={sending} onClick={() => void send()}>Send</Button>
          <Button size="lg" variant="outline" onClick={() => setSendOpen(false)}>Cancel</Button>
        </div>
      </Modal>
    </div>
  )
}
