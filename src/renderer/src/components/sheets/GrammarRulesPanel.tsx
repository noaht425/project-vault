import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseGrammarRules } from '../../../../common/noteTypes/language'

export function GrammarRulesPanel({ body }: { body: string }): React.JSX.Element | null {
  const rules = parseGrammarRules(body)
  if (rules.length === 0) return null

  return (
    <div className="word-dictionary">
      <h3>
        Grammar ({rules.length} rule{rules.length === 1 ? '' : 's'})
      </h3>
      {rules.map((rule) => (
        <div key={rule.name} className="word-entry">
          <div className="word-entry-word">{rule.name}</div>
          {rule.content && (
            <div className="word-entry-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{rule.content}</ReactMarkdown>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
