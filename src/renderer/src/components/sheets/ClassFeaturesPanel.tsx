import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseNote } from '../../../../common/frontmatter'
import { parseClassReferenceLevels, type ClassReferenceLevel } from '../../../../common/noteTypes/classReference'

type Status = 'idle' | 'loading' | 'not-found'

/** Looks up the `class-reference` note titled `classRef`, and shows only the
 *  level sections at or below the character's current `level`. */
export function ClassFeaturesPanel({
  classRef,
  level
}: {
  classRef: string
  level: number
}): React.JSX.Element | null {
  const [status, setStatus] = useState<Status>('idle')
  const [levels, setLevels] = useState<ClassReferenceLevel[]>([])

  useEffect(() => {
    const trimmed = classRef.trim()
    if (!trimmed) {
      setLevels([])
      setStatus('idle')
      return
    }

    let cancelled = false
    setStatus('loading')

    const load = async (): Promise<void> => {
      const matches = await window.vaultApi.searchTitles(trimmed, 'class-reference')
      const exact = matches.find((m) => m.title.toLowerCase() === trimmed.toLowerCase())
      if (!exact) {
        if (!cancelled) {
          setStatus('not-found')
          setLevels([])
        }
        return
      }
      const note = await window.vaultApi.readNote(exact.path)
      const { body } = parseNote(note.content)
      if (!cancelled) {
        setLevels(parseClassReferenceLevels(body))
        setStatus('idle')
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [classRef])

  if (!classRef.trim()) return null

  if (status === 'not-found') {
    return (
      <div className="class-features class-features-empty">
        No class reference note titled "{classRef}" found.
      </div>
    )
  }

  const unlocked = levels.filter((l) => l.level <= level)
  if (unlocked.length === 0) return null

  return (
    <div className="class-features">
      <h3>Class Features</h3>
      {unlocked.map((l) => (
        <div key={l.level} className="class-feature-level">
          <div className="class-feature-level-label">Level {l.level}</div>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{l.content}</ReactMarkdown>
        </div>
      ))}
    </div>
  )
}
