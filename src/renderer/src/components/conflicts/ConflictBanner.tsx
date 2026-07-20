import { useEditorStore } from '../../state/editorStore'

export function ConflictBanner(): React.JSX.Element | null {
  const conflict = useEditorStore((s) => s.conflict)
  const externalChangePending = useEditorStore((s) => s.externalChangePending)
  const dismissConflict = useEditorStore((s) => s.dismissConflict)
  const reloadFromDisk = useEditorStore((s) => s.reloadFromDisk)

  if (conflict) {
    return (
      <div className="banner banner-conflict">
        <span>
          This note changed on disk while you were editing it. Your edits were saved separately as{' '}
          <code>{conflict.conflictPath.split(/[/\\]/).pop()}</code> so nothing was lost — review both
          and merge by hand.
        </span>
        <button onClick={dismissConflict}>Dismiss</button>
      </div>
    )
  }

  if (externalChangePending) {
    return (
      <div className="banner banner-warning">
        <span>This note changed on disk. Saving now will create a conflict copy instead of overwriting it.</span>
        <button onClick={() => void reloadFromDisk()}>Reload latest (discard my edits)</button>
      </div>
    )
  }

  return null
}
