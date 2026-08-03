import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseWordEntries } from '../../../../common/noteTypes/language'

const HEIGHT_KEY = 'wordDictionaryHeight'
const MIN_HEIGHT = 80
const MAX_HEIGHT = 900
const DEFAULT_HEIGHT = 240

function loadHeight(): number {
  const stored = Number(localStorage.getItem(HEIGHT_KEY))
  return stored >= MIN_HEIGHT && stored <= MAX_HEIGHT ? stored : DEFAULT_HEIGHT
}

export function WordDictionaryPanel({ body }: { body: string }): React.JSX.Element | null {
  const entries = parseWordEntries(body)
  const [height, setHeight] = useState(loadHeight)
  // Delta-from-drag-start rather than the sidebar handle's absolute-position
  // approach (App.tsx) — the sidebar sits flush against the window's left
  // edge so clientX doubles as its width, but this panel can be anywhere
  // vertically on the page, so clientY alone isn't its height.
  const resizeStart = useRef<{ y: number; height: number } | null>(null)

  useEffect(() => {
    const onMouseMove = (e: MouseEvent): void => {
      const start = resizeStart.current
      if (!start) return
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, start.height + (e.clientY - start.y))))
    }
    const onMouseUp = (): void => {
      if (!resizeStart.current) return
      resizeStart.current = null
      setHeight((h) => {
        localStorage.setItem(HEIGHT_KEY, String(h))
        return h
      })
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  if (entries.length === 0) return null

  return (
    <div className="word-dictionary">
      <h3>
        Dictionary ({entries.length} word{entries.length === 1 ? '' : 's'})
      </h3>
      <div className="word-dictionary-list" style={{ height }}>
        {entries.map((entry) => (
          <div key={entry.word} className="word-entry">
            <div className="word-entry-word">
              {entry.word}
              {entry.partOfSpeech && <span className="word-entry-pos">{entry.partOfSpeech}</span>}
              {entry.gender && <span className="word-entry-gender">{entry.gender}</span>}
            </div>
            {entry.meaning && <div className="word-entry-meaning">{entry.meaning}</div>}
            {entry.content && (
              <div className="word-entry-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.content}</ReactMarkdown>
              </div>
            )}
          </div>
        ))}
      </div>
      <div
        className="word-dictionary-resize-handle"
        onMouseDown={(e) => {
          e.preventDefault()
          resizeStart.current = { y: e.clientY, height }
        }}
        title="Drag to resize"
      />
    </div>
  )
}
