import { useEffect, useState } from 'react'
import type { CloudSearchResult } from '../../../../common/cloudTypes'
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

// Cloud counterpart of SearchView.tsx — same debounce/marker-parsing
// approach, swapping vaultApi.search for cloudApi.search. The snippet
// markers project-vault-cloud's /api/search emits are the same control
// characters common/searchSnippet.ts defines, so parseSnippet works
// unmodified here.
export function CloudSearchView({
  query,
  onOpenResult
}: {
  query: string
  onOpenResult: (id: string) => void
}): React.JSX.Element {
  const [type, setType] = useState('')
  const [results, setResults] = useState<CloudSearchResult[] | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      void window.cloudApi.search(trimmed, type || undefined).then(setResults)
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
        <p className="right-panel-note">Type in the search box above to search all cloud notes.</p>
      ) : results === null ? (
        <p className="right-panel-note">Searching…</p>
      ) : results.length === 0 ? (
        <p className="right-panel-note">No results for "{query.trim()}".</p>
      ) : (
        <div className="search-result-list">
          {results.map((r) => (
            <button key={r.id} className="search-result" onClick={() => onOpenResult(r.id)}>
              <div className="search-result-title">
                {r.name} <span className="search-result-type">{r.noteType ?? 'note'}</span>
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
