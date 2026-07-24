import { useEffect, useState } from 'react'

interface CloudNote {
  id: string
  name: string
}

// Proof-of-concept panel for validating that the Electron app can reach
// project-vault-cloud's API through window.cloudApi (main-process IPC,
// same pattern as vaultApi) — not a real editor UI, and not wired to the
// local vault at all. Delete once the actual cloud-backed vault UI exists.
export function CloudTestView(): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signedIn, setSignedIn] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [note, setNote] = useState<CloudNote | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [tree, setTree] = useState<unknown>(null)

  const appendLog = (line: string): void => setLog((l) => [...l, line])

  // A previous run may have left a signed-in session on disk (restored by
  // the main process at startup, not awaited before the window shows) —
  // check for it rather than always starting at the sign-in form. Covers
  // both cases: restore() already finished by the time this mounts, or it
  // finishes a moment later and pushes cloud:sessionRestored.
  useEffect(() => {
    void window.cloudApi.getSession().then((session) => {
      if (session) {
        setSignedIn(true)
        appendLog(`Resumed session (${session.userId}).`)
      }
      setCheckingSession(false)
    })

    const off = window.cloudApi.onSessionRestored((session) => {
      if (session) {
        setSignedIn(true)
        appendLog(`Resumed session (${session.userId}).`)
      }
      setCheckingSession(false)
    })
    return off
  }, [])

  useEffect(() => {
    return window.cloudApi.onTreeUpdated((updated) => {
      setTree(updated)
      appendLog('Tree updated (background refresh).')
    })
  }, [])

  const signIn = async (): Promise<void> => {
    try {
      await window.cloudApi.signIn(email, password)
      setSignedIn(true)
      appendLog('Signed in.')
    } catch (err) {
      appendLog(`Sign-in failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const createNote = async (): Promise<void> => {
    try {
      const created = (await window.cloudApi.createNote({
        name: `Electron Test Note ${Date.now()}`,
        frontmatter: { type: 'note' },
        body: 'created from the desktop app'
      })) as CloudNote
      setNote(created)
      appendLog(`Created note: ${JSON.stringify(created)}`)
    } catch (err) {
      appendLog(`Create note failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const readNoteBack = async (): Promise<void> => {
    if (!note) return
    const start = performance.now()
    try {
      const fetched = await window.cloudApi.getNote(note.id)
      appendLog(`Read note back in ${Math.round(performance.now() - start)}ms: ${JSON.stringify(fetched)}`)
    } catch (err) {
      appendLog(`Read note failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // The point of this pair: loadCachedTree resolves near-instantly (no
  // network wait, possibly stale or even null on a cold start with no
  // prior session), while refreshTree always pays the real network cost.
  // Logging both timings is what actually demonstrates whether this
  // pattern solves the "feels as fast as local files" requirement.
  const loadCachedTree = async (): Promise<void> => {
    const start = performance.now()
    const cached = await window.cloudApi.getCachedTree()
    setTree(cached)
    appendLog(`Loaded cached tree in ${Math.round(performance.now() - start)}ms (may be stale/null).`)
  }

  const refreshTree = async (): Promise<void> => {
    const start = performance.now()
    try {
      await window.cloudApi.refreshTree()
      appendLog(`Refreshed tree from network in ${Math.round(performance.now() - start)}ms.`)
    } catch (err) {
      appendLog(`Refresh tree failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="right-panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3>Cloud test</h3>
      {checkingSession ? (
        <div>Checking for a resumed session…</div>
      ) : !signedIn ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input
            placeholder="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button onClick={() => void signIn()}>Sign in</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => void createNote()}>Create note via cloud API</button>
          <button disabled={!note} onClick={() => void readNoteBack()}>
            Read note back
          </button>
          <button onClick={() => void loadCachedTree()}>Load tree (cached, instant)</button>
          <button onClick={() => void refreshTree()}>Refresh tree (network)</button>
        </div>
      )}
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{log.join('\n')}</pre>
      {tree !== null && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{JSON.stringify(tree, null, 2)}</pre>}
    </div>
  )
}
