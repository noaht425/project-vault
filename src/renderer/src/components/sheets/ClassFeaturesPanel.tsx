import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseClassReferenceLevels, type ClassReferenceLevel } from '../../../../common/noteTypes/classReference'
import type { NoteRefApi } from '../../lib/noteRefApi'

type Status = 'idle' | 'loading' | 'not-found'

/** Looks up the `class-reference` note titled `classRef`, and shows only the
 *  level sections at or below the character's current `level`. */
export function ClassFeaturesPanel({
  classRef,
  level,
  noteRefApi
}: {
  classRef: string
  level: number
  noteRefApi: NoteRefApi
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
      const body = await noteRefApi.readBodyByTitle(trimmed, 'class-reference')
      if (body === null) {
        if (!cancelled) {
          setStatus('not-found')
          setLevels([])
        }
        return
      }
      if (!cancelled) {
        setLevels(parseClassReferenceLevels(body))
        setStatus('idle')
      }
    }

    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
