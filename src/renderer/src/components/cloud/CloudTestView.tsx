import { useState } from 'react'

// Proof-of-concept panel for validating that the Electron app can reach
// project-vault-cloud's API through window.cloudApi (main-process IPC,
// same pattern as vaultApi) — not a real editor UI, and not wired to the
// local vault at all. Delete once the actual cloud-backed vault UI exists.
export function CloudTestView(): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signedIn, setSignedIn] = useState(false)
  const [log, setLog] = useState<string[]>([])

  const appendLog = (line: string): void => setLog((l) => [...l, line])

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
      const note = await window.cloudApi.createNote({
        name: `Electron Test Note ${Date.now()}`,
        frontmatter: { type: 'note' },
        body: 'created from the desktop app'
      })
      appendLog(`Created note: ${JSON.stringify(note)}`)
    } catch (err) {
      appendLog(`Create note failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="right-panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3>Cloud test</h3>
      {!signedIn ? (
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
        <button onClick={() => void createNote()}>Create note via cloud API</button>
      )}
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{log.join('\n')}</pre>
    </div>
  )
}
