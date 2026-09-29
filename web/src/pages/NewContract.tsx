import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { api, navigate, type ContractDetail } from '@/lib/api'
import { inputClass } from './Login'

export function NewContract() {
  const [title, setTitle] = useState('')
  const [proposerOrgName, setProposerOrgName] = useState('')
  const [counterpartyOrgName, setCounterpartyOrgName] = useState('')
  const [counterpartyEmail, setCounterpartyEmail] = useState('')
  const [team, setTeam] = useState<{ email: string; name: string }[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const contract = await api<ContractDetail>('/contracts', {
        body: { title, proposerOrgName, counterpartyOrgName, counterpartyEmail, team },
      })
      navigate(`/contracts/${contract.id}`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  function updateMember(index: number, field: 'email' | 'name', value: string) {
    setTeam(team.map((member, i) => (i === index ? { ...member, [field]: value } : member)))
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <form onSubmit={submit} className="sheet px-6 py-10 sm:px-12">
        <label className="block">
          <span className="text-sm text-ink-muted">Contract name</span>
          <input
            className={`${inputClass} font-serif text-3xl`}
            required
            autoFocus
            maxLength={200}
            placeholder="Master Services Agreement"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <div className="mt-10 grid gap-10 sm:grid-cols-2 sm:gap-0">
          <fieldset className="space-y-5 sm:pr-8">
            <legend className="mb-5 font-serif text-xl text-ink">Your side</legend>
            <label className="block">
              <span className="text-sm text-ink-muted">Organisation</span>
              <input className={inputClass} required maxLength={200} value={proposerOrgName} onChange={(e) => setProposerOrgName(e.target.value)} />
            </label>
            <div className="space-y-3">
              <span className="text-sm text-ink-muted">Team members (optional)</span>
              {team.map((member, index) => (
                <div key={index} className="space-y-1">
                  <input className={inputClass} type="email" required placeholder="Email" value={member.email} onChange={(e) => updateMember(index, 'email', e.target.value)} />
                  <div className="flex items-end gap-2">
                    <input className={inputClass} placeholder="Name (optional)" maxLength={200} value={member.name} onChange={(e) => updateMember(index, 'name', e.target.value)} />
                    <Button type="button" variant="ghost" onClick={() => setTeam(team.filter((_, i) => i !== index))}>
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={() => setTeam([...team, { email: '', name: '' }])}>
                Add team member
              </Button>
            </div>
          </fieldset>

          <fieldset className="space-y-5 sm:border-l sm:border-rule sm:pl-8">
            <legend className="mb-5 font-serif text-xl text-ink">Other side</legend>
            <label className="block">
              <span className="text-sm text-ink-muted">Organisation</span>
              <input className={inputClass} required maxLength={200} value={counterpartyOrgName} onChange={(e) => setCounterpartyOrgName(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-sm text-ink-muted">Contact email</span>
              <input className={inputClass} type="email" required value={counterpartyEmail} onChange={(e) => setCounterpartyEmail(e.target.value)} />
            </label>
            <p className="text-sm text-ink-muted">They'll get an email invite. Their team can be added later.</p>
          </fieldset>
        </div>

        <div className="mt-12 flex items-center gap-4 border-t border-rule pt-6">
          <Button type="submit" size="lg" className="h-10 px-5" disabled={busy}>
            Create contract
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </form>
    </div>
  )
}
