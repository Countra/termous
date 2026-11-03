import type { ReactNode } from 'react'
import { BookOpen, FileJson2, Search, Unplug } from 'lucide-react'
import { WorkspaceEmptyState } from '#shared/ui'
import styles from './IntegrationEmptyState.module.scss'

export function IntegrationEmptyState({ kind, title, description, action }: {
  kind: 'mcp' | 'skill' | 'search' | 'configuration'
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}) {
  const Icon = { mcp: Unplug, skill: BookOpen, search: Search, configuration: FileJson2 }[kind]
  return <WorkspaceEmptyState className={styles.root} icon={<Icon size={22} strokeWidth={1.5} />}
    title={title} description={description} action={action} />
}
