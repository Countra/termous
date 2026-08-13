import { Pencil, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import styles from './EditorModeContext.module.scss'

export type EditorMode = 'create' | 'edit'
export type EditorModeContextSize = 'default' | 'compact'

export interface EditorModeContextProps {
  mode: EditorMode
  label: string
  title?: ReactNode
  size?: EditorModeContextSize
  className?: string
}

export function EditorModeContext({
  mode,
  label,
  title,
  size = 'default',
  className,
}: EditorModeContextProps) {
  const Icon = mode === 'create' ? Plus : Pencil

  return (
    <div
      className={[
        styles['editor-mode-context'],
        styles[`is-${mode}`],
        size === 'compact' ? styles['is-compact'] : '',
        title === undefined ? styles['is-mode-only'] : '',
        className,
      ].filter(Boolean).join(' ')}
      data-editor-mode={mode}
      data-editor-size={size}
    >
      {title === undefined ? null : (
        <div className={styles['editor-mode-context-title']}>
          {title}
        </div>
      )}
      <div className={styles['editor-mode-context-meta']}>
        <Icon
          className={styles['editor-mode-context-icon']}
          size={size === 'compact' ? 12 : 13}
          aria-hidden="true"
        />
        <span className={styles['editor-mode-context-label']}>{label}</span>
      </div>
    </div>
  )
}
