import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { DropdownMenu } from 'radix-ui'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { JSONContent } from '@tiptap/react'
import { SimpleEditor } from '@/components/tiptap-templates/simple/simple-editor'
import { spotOffsets } from '@/components/tiptap-ui/redlining/signatureSpot'
import { api, ApiError, type ChangeItem, type ChatItem, type ContractDetail, type ThreadItem, type User, type VersionSummary } from '@/lib/api'
import { ChangesPanel, type ChangeAction } from './ChangesPanel'
import { StatusBadge } from '../Contracts'
import { AiPanel, AskAi } from './AiPanels'
import { ChatPanel, CommentsPanel, type ThreadTarget } from './DiscussionPanels'
import { DocumentSection, ViewStyles, type ViewMode } from './DocumentSection'
import { Modal, PeopleDialog } from './PeopleDialog'
import { SignDialog } from './SignDialog'
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
  const [readyOpen, setReadyOpen] = useState(false)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [placing, setPlacing] = useState(false)
  // Errors from Ready to sign, Undo, Reopen and Export, shown under the header.
  const [actionError, setActionError] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [signOpen, setSignOpen] = useState(false)

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

  async function act(action: () => Promise<void>) {
    setActionBusy(true)
    setActionError('')
    try {
      await action()
      await load()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setActionBusy(false)
    }
  }

  // The file comes back as a download rather than JSON, so this skips api().
  function download(path: string) {
    void act(async () => {
      const response = await fetch(`/api/contracts/${id}${path}`)
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string }
        throw new ApiError(response.status, data.message ?? response.statusText)
      }
      const filename = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'contract'
      const link = document.createElement('a')
      link.href = URL.createObjectURL(await response.blob())
      link.download = filename
      link.click()
      URL.revokeObjectURL(link.href)
    })
  }

  if (!contract) return <p className="px-6 py-20 text-sm text-destructive">{error}</p>

  const myParty = contract.parties.find((party) => party.participants.some((p) => p.user.id === user.id))
  const turnParty = contract.parties.find((party) => party.id === contract.currentTurnPartyId)
  const otherParty = contract.parties.find((party) => party.id !== myParty?.id)
  const proposer = contract.parties.find((party) => party.role === 'PROPOSER')
  const canSend = myTurn && contract.status !== 'READY_TO_SIGN' && contract.status !== 'SIGNED'
  const negotiating = contract.status === 'WITH_PROPOSER' || contract.status === 'WITH_COUNTERPARTY'
  // Why Ready to sign can't be clicked yet, if it can't.
  const readyBlocker =
    changes.length > 0
      ? 'Every change must be accepted or rejected first.'
      : !contract.hasUnsentChanges
        ? ''
        : myTurn
          ? 'Send your latest changes first, so the other side sees the final text.'
          : `${otherParty?.orgName} has changes they haven't sent yet.`
  const spotsPlaced = contract.draftContent !== null && Object.keys(spotOffsets(contract.draftContent)).length === 2
  const signing = contract.signingRequests[0]
  const signerName = (party: (typeof contract.parties)[number]) => party.signer?.name ?? party.signer?.email ?? 'someone'
  const canSign = contract.status === 'READY_TO_SIGN' && signing?.status === 'PENDING' && myParty?.signer?.id === user.id && !myParty.signedAt
  // Signing is stuck: a side still has to choose a signer, the document to sign couldn't be made,
  // or both have signed but the signed copy couldn't be made.
  const signingBlocker =
    contract.status !== 'READY_TO_SIGN'
      ? ''
      : !signing
        ? contract.parties.some((party) => !party.signer)
          ? `${contract.parties.find((party) => !party.signer)?.orgName} needs to choose who signs (People).`
          : "Signing couldn't start."
        : contract.parties.every((party) => party.signedAt)
          ? "Both sides have signed, but the signed copy couldn't be made yet."
          : ''
  const signedOn = contract.parties.map((party) => party.signedAt).sort().at(-1)
  const labels = contract.parties.reduce(
    (all, party) => ({ ...all, [party.role]: `${party.orgName} signs here` }),
    { PROPOSER: '', COUNTERPARTY: '' },
  )

  function markReady(placement?: 'SPOTS' | 'PAGE') {
    void act(async () => {
      await api(`/contracts/${id}/ready`, { body: placement ? { placement } : {} })
      setReadyOpen(false)
    })
  }

  return (
    <div className="flex flex-1 flex-col">
      {myParty && <ViewStyles partyId={myParty.id} />}
      <header className="flex flex-wrap items-center justify-between gap-4 border-y border-rule bg-paper px-6 py-4">
        <div className="min-w-0">
          <h2 className="m-0 truncate font-serif text-2xl font-medium text-ink">{contract.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={contract.status} />
            {contract.status === 'SIGNED' ? (
              <span className="font-medium text-action">Signed by both sides{signedOn && ` on ${formatDate(signedOn)}`}</span>
            ) : contract.status === 'READY_TO_SIGN' ? (
              <span className="font-medium text-action">
                {contract.parties
                  .map((party) => (party.signedAt ? `${party.orgName} signed` : `Waiting for ${signerName(party)} (${party.orgName}) to sign`))
                  .join(' · ')}
              </span>
            ) : turnParty && (
              <span className={myTurn ? 'font-medium text-action' : 'text-ink-muted'}>
                {myTurn ? 'Your turn' : `Waiting for ${turnParty.orgName} to respond`}
              </span>
            )}
            {negotiating && otherParty?.readyAt && !myParty?.readyAt && (
              <span className="text-ink-muted">· {otherParty.orgName} is ready to sign</span>
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
          <Menu label="Export">
            {contract.status === 'SIGNED' && (
              <>
                <DropdownMenu.Item className={menuItemClass} onSelect={() => download('/signed-pdf')}>Signed PDF</DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-rule" />
              </>
            )}
            <p className="px-3 py-2 text-xs text-ink-muted">A clean copy, without red or green marks.</p>
            <DropdownMenu.Item className={menuItemClass} onSelect={() => download('/export?format=docx')}>Word (.docx)</DropdownMenu.Item>
            <DropdownMenu.Item className={menuItemClass} onSelect={() => download('/export?format=pdf')}>PDF</DropdownMenu.Item>
          </Menu>
          {negotiating && myParty?.readyAt && (
            <>
              <Button variant="outline" disabled>Waiting for {otherParty?.orgName}</Button>
              <Button variant="ghost" disabled={actionBusy} onClick={() => void act(() => api(`/contracts/${id}/ready`, { method: 'DELETE' }))}>
                Undo ready
              </Button>
            </>
          )}
          {negotiating && !myParty?.readyAt && (
            <Button
              variant="outline"
              disabled={Boolean(readyBlocker) || placing}
              title={readyBlocker || undefined}
              onClick={() => {
                setActionError('')
                setReadyOpen(true)
              }}
            >
              Ready to sign
            </Button>
          )}
          {canSign && (
            <Button onClick={() => setSignOpen(true)}>Sign</Button>
          )}
          {contract.status === 'READY_TO_SIGN' && !myParty?.signedAt && (
            <Button
              variant="outline"
              onClick={() => {
                setActionError('')
                setReopenOpen(true)
              }}
            >
              Reopen for changes
            </Button>
          )}
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
      {actionError && !readyOpen && !reopenOpen && (
        <p className="border-b border-rule bg-paper px-6 py-3 text-sm text-destructive">{actionError}</p>
      )}
      {contract.status === 'SIGNED' && signing?.signedDocHash && (
        <p className="flex flex-wrap items-center gap-3 border-b border-rule bg-paper px-6 py-3 text-sm text-ink">
          <Button size="sm" onClick={() => download('/signed-pdf')}>Download signed PDF</Button>
          <span className="break-all text-xs text-ink-muted">Fingerprint (SHA-256): {signing.signedDocHash}</span>
        </p>
      )}
      {signingBlocker && (
        <p className="flex flex-wrap items-center gap-3 border-b border-rule bg-paper px-6 py-3 text-sm text-ink">
          {signingBlocker}
          <Button size="sm" variant="outline" disabled={actionBusy} onClick={() => void act(() => api(`/contracts/${id}/signing/retry`, { method: 'POST' }))}>
            Try again
          </Button>
        </p>
      )}
      {negotiating && !myParty?.readyAt && readyBlocker && otherParty?.readyAt && (
        <p className="border-b border-rule bg-paper px-6 py-3 text-sm text-ink-muted">Ready to sign: {readyBlocker}</p>
      )}

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
                  <SimpleEditor key={viewing.versionNumber} content={viewing.content} editable={false} spotLabels={labels} />
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
                placing={placing}
                onPlacingEnd={() => {
                  setPlacing(false)
                  void load()
                }}
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
            AI: <AiPanel contractId={id} changes={changes} myPartyId={myParty?.id} />,
          }}
        />
      </div>

      {contract.draftContent && <AskAi contractId={id} />}

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

      <Modal title="Ready to sign?" open={readyOpen} onOpenChange={setReadyOpen}>
        <p className="text-sm leading-relaxed text-ink-muted">
          You're confirming this text is final for {myParty?.orgName}. Once both sides are ready, the contract can be signed. Any
          change to the text before then clears both sides' Ready.
        </p>
        {myParty?.role === 'PROPOSER' ? (
          <>
            <p className="mt-6 text-sm font-medium text-ink">Where should signatures go?</p>
            <div className="mt-3 flex flex-col gap-2">
              <Button
                size="lg"
                disabled={actionBusy}
                onClick={() => {
                  setReadyOpen(false)
                  setViewing(null)
                  setPlacing(true)
                }}
              >
                {spotsPlaced ? 'Move signature spots' : 'Place signature spots'}
              </Button>
              {spotsPlaced && (
                <Button size="lg" variant="outline" disabled={actionBusy} onClick={() => markReady('SPOTS')}>
                  Keep spots where they are
                </Button>
              )}
              <Button size="lg" variant="outline" disabled={actionBusy} onClick={() => markReady('PAGE')}>
                Use a signature page
              </Button>
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              Spots mark where each side signs in the document. If you don't place them, a signature page is added at the end.
            </p>
          </>
        ) : (
          <>
            <p className="mt-4 text-sm leading-relaxed text-ink">
              {!proposer?.readyAt
                ? `${proposer?.orgName} will choose where signatures go. You'll see it before you sign.`
                : contract.signaturePlacement === 'SPOTS'
                  ? `Signatures will go where ${proposer.orgName} marked.`
                  : 'Signatures will go on a page added at the end.'}
            </p>
            <div className="mt-8 flex gap-2">
              <Button size="lg" disabled={actionBusy} onClick={() => markReady()}>I'm ready to sign</Button>
              <Button size="lg" variant="outline" onClick={() => setReadyOpen(false)}>Cancel</Button>
            </div>
          </>
        )}
        {actionError && <p className="mt-4 text-sm text-destructive">{actionError}</p>}
      </Modal>

      {myParty && (
        <SignDialog
          contractId={id}
          orgName={myParty.orgName}
          defaultName={user.name ?? ''}
          open={signOpen}
          onOpenChange={setSignOpen}
          onReopenInstead={() => {
            setSignOpen(false)
            setActionError('')
            setReopenOpen(true)
          }}
        />
      )}

      <Modal title="Reopen for changes?" open={reopenOpen} onOpenChange={setReopenOpen}>
        <p className="text-sm leading-relaxed text-ink-muted">
          The contract goes back to negotiating and it becomes your turn. The text doesn't change. Both sides are emailed and will
          need to click Ready to sign again.
        </p>
        {actionError && <p className="mt-4 text-sm text-destructive">{actionError}</p>}
        <div className="mt-8 flex gap-2">
          <Button
            size="lg"
            disabled={actionBusy}
            onClick={() =>
              void act(async () => {
                await api(`/contracts/${id}/reopen`, { method: 'POST' })
                setReopenOpen(false)
              })
            }
          >
            Reopen
          </Button>
          <Button size="lg" variant="outline" onClick={() => setReopenOpen(false)}>Cancel</Button>
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
