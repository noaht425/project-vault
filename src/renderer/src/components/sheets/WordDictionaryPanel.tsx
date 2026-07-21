import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseWordEntries } from '../../../../common/noteTypes/language'

export function WordDictionaryPanel({ body }: { body: string }): React.JSX.Element | null {
  const entries = parseWordEntries(body)
  if (entries.length === 0) return null

  return (
    <div className="word-dictionary">
      <h3>
        Dictionary ({entries.length} word{entries.length === 1 ? '' : 's'})
      </h3>
      {entries.map((entry) => (
        <div key={entry.word} className="word-entry">
          <div className="word-entry-word">{entry.word}</div>
          {entry.content && (
            <div className="word-entry-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.content}</ReactMarkdown>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
