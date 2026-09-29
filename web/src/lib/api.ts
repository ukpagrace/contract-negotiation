import type { JSONContent } from '@tiptap/react'

export interface User {
  id: string
  email: string
  name: string | null
}

export type PartyRole = 'PROPOSER' | 'COUNTERPARTY'

export interface ContractSummary {
  id: string
  title: string
  status: string
  updatedAt: string
}

export interface ContractDetail {
  id: string
  title: string
  status: string
  currentTurnPartyId: string | null
  draftContent: JSONContent | null
  parties: {
    id: string
    role: PartyRole
    orgName: string
    participants: { id: string; user: User }[]
    invites: { id: string; email: string; expiresAt: string }[]
  }[]
}

export interface LockHolder {
  userId: string
  name: string
}

export interface InviteInfo {
  email: string
  contractTitle: string
  role: PartyRole
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, options: { method?: string; body?: object } = {}): Promise<T> {
  const isForm = options.body instanceof FormData
  const response = await fetch(`/api${path}`, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers: options.body && !isForm ? { 'content-type': 'application/json' } : undefined,
    body: isForm ? (options.body as FormData) : options.body ? JSON.stringify(options.body) : undefined,
  })
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: string }
    throw new ApiError(response.status, data.message ?? response.statusText)
  }
  // Nest sends an empty body for null results as well as for 204s.
  const text = await response.text()
  return (text ? JSON.parse(text) : null) as T
}

export function navigate(to: string, state?: { notice: string }): void {
  history.pushState(state ?? null, '', to)
  dispatchEvent(new PopStateEvent('popstate'))
}
