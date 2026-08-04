import { useEffect, useState } from 'react'
import type { SearchResult } from '../../../../common/types'
import { parseSnippet } from '../../../../common/searchSnippet'

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All types' },
  { value: 'note', label: 'Note' },
  { value: 'pc', label: 'PC' },
  { value: 'npc', label: 'NPC' },
  { value: 'class-reference', label: 'Class Reference' },
  { value: 'session', label: 'Session' }
]

const DEBOUNCE_MS = 200

export function SearchView({
  query,
  onOpenResult
}: {
  query: string
  onOpenResult: (path: string) => void
}): React.JSX.Element {
  const [type, setType] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      // Without a .catch, a rejected IPC call (e.g. no vault open) left
      // results stuck at null forever — "Searching…" with no way out.
      window.vaultApi
        .search(trimmed, type || undefined)
        .then(setResults)
        .catch((err) => {
          console.error('Search failed:', err)
          setResults([])
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, type])

  return (
    <div className="search-view">
      <div className="search-view-header">
        <h2>Search</h2>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {!query.trim() ? (
        <p className="right-panel-note">Type in the search box above to search all notes.</p>
      ) : results === null ? (
        <p className="right-panel-note">Searching…</p>
      ) : results.length === 0 ? (
        <p className="right-panel-note">No results for "{query.trim()}".</p>
      ) : (
        <div className="search-result-list">
          {results.map((r) => (
            <button key={r.path} className="search-result" onClick={() => onOpenResult(r.path)}>
              <div className="search-result-title">
                {r.title} <span className="search-result-type">{r.type}</span>
              </div>
              <div className="search-result-snippet">
                {parseSnippet(r.snippet).map((seg, i) =>
                  seg.highlighted ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
