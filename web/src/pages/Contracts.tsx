import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api, navigate, type ContractSummary } from '@/lib/api'

const statusLabels: Record<string, string> = {
  DRAFT: 'Draft',
  WITH_COUNTERPARTY: 'With counterparty',
  WITH_PROPOSER: 'With proposer',
  READY_TO_SIGN: 'Ready to sign',
  SIGNED: 'Signed',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="rounded-full border border-rule px-2.5 py-0.5 text-xs text-ink-muted">{statusLabels[status]}</span>
  )
}

export function ContractList() {
  const [contracts, setContracts] = useState<ContractSummary[] | null>(null)

  useEffect(() => {
    void api<ContractSummary[]>('/contracts').then(setContracts)
  }, [])

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-end justify-between">
        <h2 className="m-0 font-serif text-3xl font-medium text-ink">Your contracts</h2>
        <Button size="lg" onClick={() => navigate('/new')}>
          Start a contract
        </Button>
      </div>
      <div className="sheet">
        {contracts?.length === 0 && (
          <p className="px-6 py-12 text-center text-sm text-ink-muted sm:px-10">
            No contracts yet. Start one to invite the other side.
          </p>
        )}
        {contracts?.map((contract) => (
          <button
            key={contract.id}
            onClick={() => navigate(`/contracts/${contract.id}`)}
            className="flex w-full items-center justify-between gap-4 border-b border-rule px-6 py-5 text-left last:border-b-0 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none sm:px-10"
          >
            <span className="font-serif text-lg text-ink">{contract.title}</span>
            <StatusBadge status={contract.status} />
          </button>
        ))}
      </div>
    </div>
  )
}
