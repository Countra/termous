import type { ReactNode } from 'react'
import styles from './ManagementWorkspace.module.scss'

export type ManagementWorkspaceView = 'catalog' | 'editor'

interface ManagementWorkspaceProps {
  activeView: ManagementWorkspaceView
  catalog: ReactNode
  editor: ReactNode
  className?: string
  catalogLabel?: string
  editorLabel?: string
}

interface ManagementPanelProps {
  header: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
  bodyClassName?: string
}

export function ManagementWorkspace({
  activeView,
  catalog,
  editor,
  className,
  catalogLabel,
  editorLabel,
}: ManagementWorkspaceProps) {
  return (
    <section
      className={['management-workspace', styles['management-workspace'], className].filter(Boolean).join(' ')}
      data-active-view={activeView}
    >
      <div className={`management-workspace-grid ${styles['management-workspace-grid']}`}>
        <div
          className={`management-workspace-pane is-catalog ${styles['management-workspace-pane']} ${styles['is-catalog']}`}
          role="region"
          aria-label={catalogLabel}
        >
          {catalog}
        </div>
        <div
          className={`management-workspace-pane is-editor ${styles['management-workspace-pane']} ${styles['is-editor']}`}
          role="region"
          aria-label={editorLabel}
        >
          {editor}
        </div>
      </div>
    </section>
  )
}

export function ManagementPanel({
  header,
  children,
  footer,
  className,
  bodyClassName,
}: ManagementPanelProps) {
  return (
    <section className={['management-panel', styles['management-panel'], className].filter(Boolean).join(' ')}>
      <header className={`management-panel-header ${styles['management-panel-header']}`}>{header}</header>
      <div
        className={['management-panel-body', styles['management-panel-body'], bodyClassName].filter(Boolean).join(' ')}
      >
        {children}
      </div>
      {footer ? (
        <footer className={`management-panel-footer ${styles['management-panel-footer']}`}>{footer}</footer>
      ) : null}
    </section>
  )
}
