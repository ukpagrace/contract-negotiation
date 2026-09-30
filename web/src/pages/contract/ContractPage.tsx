import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { DropdownMenu } from 'radix-ui'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { JSONContent } from '@tiptap/react'
import { SimpleEditor } from '@/components/tiptap-templates/simple/simple-editor'
import { api, type ChangeItem, type ChatItem, type ContractDetail, type ThreadItem, type User, type VersionSummary } from '@/lib/api'
import { ChangesPanel, type ChangeAction } from './ChangesPanel'
import { StatusBadge } from '../Contracts'
import { ChatPanel, CommentsPanel, type ThreadTarget } from './DiscussionPanels'
import { DocumentSection, ViewStyles, type ViewMode } from './DocumentSection'
import { Modal, PeopleDialog } from './PeopleDialog'
import { Sidebar, type Tab } from './Sidebar'

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
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restoreError, setRestoreError] = useState('')
  const [changes, setChanges] = useState<ChangeItem[]>([])
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null)
  const [sidebarTab, setSidebarTab] = useState<Tab>('Changes')
  const [changeBusy, setChangeBusy] = useState<string | null>(null)
  const [changeError, setChangeError] = useState('')
  // Bumped when the server rewrites the document (accept/reject), so the editor reloads it.
  const [docVersion, setDocVersion] = useState(0)
  const [lockSignal, setLockSignal] = useState(0)
  const [threads, setThreads] = useState<ThreadItem[]>([])
  const [chat, setChat] = useState<ChatItem[]>([])
  const [threadTarget, setThreadTarget] = useState<ThreadTarget | null>(null)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  // Ids of text threads whose text the editor found; null until it has looked.
  const [foundThreadIds, setFoundThreadIds] = useState<string[] | null>(null)

  async function load() {
    try {
      const [detail, pending] = await Promise.all([
        api<ContractDetail>(`/contracts/${id}`),
        api<ChangeItem[]>(`/contracts/${id}/changes`),
      ])
      setContract(detail)
      setChanges(pending)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const loadThreads = () => api<ThreadItem[]>(`/contracts/${id}/threads`).then(setThreads, () => undefined)
  const loadChat = () => api<ChatItem[]>(`/contracts/${id}/chat`).then(setChat, () => undefined)

  useEffect(() => {
    void load()
  }, [id, user.name])

  useEffect(() => {
    void loadThreads()
    void loadChat()
    const source = new EventSource(`/api/contracts/${id}/events`)
    let dropped = false
    source.onmessage = (event: MessageEvent<string>) => {
      const { type } = JSON.parse(event.data) as { type: string }
      if (type === 'contract') void load()
      else if (type === 'document') void load().then(() => setDocVersion((v) => v + 1))
      else if (type === 'lock') setLockSignal((n) => n + 1)
      else if (type === 'comments') void loadThreads()
      else if (type === 'chat') void loadChat()
    }
    // The browser reconnects by itself; afterwards, catch up on anything missed meanwhile.
    source.onerror = () => {
      dropped = true
    }
    source.onopen = () => {
      if (!dropped) return
      dropped = false
      void load()
      void loadThreads()
      void loadChat()
      setLockSignal((n) => n + 1)
    }
    return () => source.close()
  }, [id])

  const anchors = useMemo(
    () =>
      threads
        .filter((t) => t.status === 'OPEN' && t.quote !== null && t.prefix !== null && t.suffix !== null)
        .map((t) => ({ threadId: t.id, quote: t.quote!, prefix: t.prefix!, suffix: t.suffix! })),
    [threads],
  )

  const myTurn = contract !== null && contract.currentTurnPartyId !== null && contract.parties.some(
    (party) => party.id === contract.currentTurnPartyId && party.participants.some((p) => p.user.id === user.id),
  )

  async function openVersion(version: VersionSummary) {
    const { content } = await api<{ content: JSONContent }>(`/contracts/${id}/versions/${version.versionNumber}`)
    setViewing({ ...version, content })
  }

  function selectChange(changeId: string) {
    setSelectedChangeId(changeId)
    setSidebarTab('Changes')
  }

  function selectThread(threadId: string) {
    setSelectedThreadId(threadId)
    setSidebarTab('Comments')
  }

  function startThread(target: ThreadTarget) {
    setThreadTarget(target)
    setSelectedThreadId(null)
    setSidebarTab('Comments')
  }

  // Text threads are outdated when their text is gone; change threads when the change is no longer pending.
  const isOutdated = (thread: ThreadItem) =>
    thread.prefix === null
      ? !changes.some((change) => change.id === thread.changeId)
      : foundThreadIds !== null && !foundThreadIds.includes(thread.id)

  async function resolveChange(changeId: string, action: ChangeAction) {
    setChangeBusy(changeId)
    setChangeError('')
    try {
      await api(`/contracts/${id}/changes/${changeId}/${action}`, { method: 'POST' })
      setSelectedChangeId(null)
      await load()
      setDocVersion((v) => v + 1)
    } catch (err) {
      setChangeError((err as Error).message)
    } finally {
      setChangeBusy(null)
    }
  }

  async function restore() {
    if (!viewing) return
    setRestoreError('')
    try {
      await api(`/contracts/${id}/versions/${viewing.versionNumber}/restore`, { method: 'POST' })
      setRestoreOpen(false)
      setViewing(null)
      await load()
      setDocVersion((v) => v + 1)
    } catch (err) {
      setRestoreError((err as Error).message)
    }
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
          <div className="mx-auto max-w-4xl">
            {viewing && (
              <section className="sheet">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-muted px-6 py-4 sm:px-12">
                  <span className="text-sm text-ink">
                    Viewing version {viewing.versionNumber}, sent by {viewing.sentByParty.orgName} on {formatDate(viewing.sentAt)}
                  </span>
                  <div className="flex gap-2">
                    {canSend && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setRestoreError('')
                          setRestoreOpen(true)
                        }}
                      >
                        Restore this version
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => setViewing(null)}>Back to current</Button>
                  </div>
                </div>
                <div className={`px-6 sm:px-12 ${view === 'theirs' ? 'redline-theirs' : ''}`}>
                  <SimpleEditor key={viewing.versionNumber} content={viewing.content} editable={false} />
                </div>
              </section>
            )}
            <div className={viewing ? 'hidden' : undefined}>
              <DocumentSection
                key={`${contract.id}-${contract.currentTurnPartyId}-${docVersion}`}
                contract={contract}
                user={user}
                canEdit={canSend}
                myPartyId={myParty?.id}
                view={view}
                selectedChangeId={selectedChangeId}
                onSelectChange={selectChange}
                onSaved={() => void load()}
                lockSignal={lockSignal}
                anchors={anchors}
                onAnchorsFound={setFoundThreadIds}
                selectedThreadId={selectedThreadId}
                onSelectThread={selectThread}
                onComment={(anchor) => startThread({ anchor })}
              />
            </div>
          </div>
        </main>
        <Sidebar
          active={sidebarTab}
          onActiveChange={setSidebarTab}
          panels={{
            Changes: (
            <ChangesPanel
              changes={changes}
              tracking={contract.status !== 'DRAFT'}
              myPartyId={myParty?.id}
              myTurn={myTurn}
              selectedId={selectedChangeId}
              busyId={changeBusy}
              error={changeError}
              onSelect={setSelectedChangeId}
              onAction={(changeId, action) => void resolveChange(changeId, action)}
              onComment={(change) => startThread({ changeId: change.id, quote: change.text })}
            />
            ),
            Comments: (
              <CommentsPanel
                contractId={id}
                userId={user.id}
                threads={threads}
                target={threadTarget}
                isOutdated={isOutdated}
                selectedId={selectedThreadId}
                onSelect={(thread) => {
                  setSelectedThreadId(thread.id)
                  const selector = thread.prefix === null && thread.changeId
                    ? `[data-change-id="${CSS.escape(thread.changeId)}"]`
                    : `[data-thread-id="${CSS.escape(thread.id)}"]`
                  document.querySelector(`.ProseMirror ${selector}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                }}
                onCancelTarget={() => setThreadTarget(null)}
                onChanged={loadThreads}
              />
            ),
            Chat: <ChatPanel contractId={id} userId={user.id} messages={chat} onChanged={loadChat} />,
          }}
        />
      </div>

      <PeopleDialog
        contract={contract}
        user={user}
        myParty={myParty}
        open={peopleOpen}
        onOpenChange={setPeopleOpen}
        onChanged={load}
      />

      <Modal title={`Restore version ${viewing?.versionNumber}?`} open={restoreOpen} onOpenChange={setRestoreOpen}>
        <p className="text-sm leading-relaxed text-ink-muted">
          The draft goes back to this version's text, keeping what your side was proposing in it and leaving out the other side's
          proposals. Differences from the current text show as your tracked changes, replacing any your side has made since it
          was sent to you.
        </p>
        {restoreError && <p className="mt-4 text-sm text-destructive">{restoreError}</p>}
        <div className="mt-8 flex gap-2">
          <Button size="lg" onClick={() => void restore()}>Restore</Button>
          <Button size="lg" variant="outline" onClick={() => setRestoreOpen(false)}>Cancel</Button>
        </div>
      </Modal>

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
