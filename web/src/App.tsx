import { useEffect, useState } from 'react'
import './App.css'
import { Button } from './components/ui/button'
import { api, navigate, type User } from './lib/api'
import { ContractList, ContractPage } from './pages/Contracts'
import { HomePage } from './pages/Homepage'
import { Invite } from './pages/Invite'
import { Login } from './pages/Login'
import { NewContract } from './pages/NewContract'

function App() {
  const [path, setPath] = useState(location.pathname)
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [nameDraft, setNameDraft] = useState<string | null>(null)

  useEffect(() => {
    const onPop = () => setPath(location.pathname)
    addEventListener('popstate', onPop)
    api<User>('/auth/me').then(setUser, () => setUser(null))
    return () => removeEventListener('popstate', onPop)
  }, [])

  if (user === undefined) return null

  const inviteToken = path.match(/^\/invite\/([^/]+)$/)?.[1]
  const contractId = path.match(/^\/contracts\/([^/]+)$/)?.[1]
  const needsLogin = !user && !inviteToken && path !== '/'

  let page
  if (inviteToken) page = <Invite token={inviteToken} user={user} onUser={setUser} />
  else if (needsLogin) page = <Login onDone={setUser} />
  else if (path === '/') page = <HomePage onStart={() => navigate(user ? '/new' : '/contracts')} />
  else if (path === '/new') page = <NewContract />
  else if (path === '/contracts') page = <ContractList />
  else if (contractId && user) page = <ContractPage id={contractId} user={user} />
  else page = <p className="mx-auto max-w-3xl px-4 py-20 text-sm text-ink-muted sm:px-6">Page not found.</p>

  return (
    <>
      {user && (
        <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 pt-6 text-sm sm:px-6">
          <button className="font-serif text-lg text-ink hover:text-action" onClick={() => navigate('/contracts')}>
            Contracts
          </button>
          <span className="flex items-center gap-2 text-ink-muted">
            {nameDraft === null ? (
              <button className="hover:text-ink" title="Edit your name" onClick={() => setNameDraft(user.name ?? '')}>
                {user.name ?? user.email}
              </button>
            ) : (
              <form
                className="flex items-center gap-2"
                onSubmit={async (e) => {
                  e.preventDefault()
                  setUser(await api<User>('/auth/me', { method: 'PATCH', body: { name: nameDraft } }))
                  setNameDraft(null)
                }}
              >
                <input
                  className="field w-40"
                  aria-label="Your name"
                  required
                  autoFocus
                  maxLength={200}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setNameDraft(null)}
                />
                <Button type="submit" variant="outline">Save</Button>
              </form>
            )}
            <Button
              variant="ghost"
              onClick={async () => {
                await api('/auth/logout', { method: 'POST' })
                setUser(null)
                navigate('/')
              }}
            >
              Sign out
            </Button>
          </span>
        </header>
      )}
      {page}
    </>
  )
}

export default App
