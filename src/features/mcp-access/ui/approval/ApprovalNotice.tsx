import { Info, ShieldAlert } from 'lucide-react'
import styles from './ApprovalDetails.module.scss'

export function ApprovalNotice({ title, description, warning = false }: { title: string; description: string; warning?: boolean }) {
  const Icon = warning ? ShieldAlert : Info
  return <aside className={styles.notice} data-warning={warning}>
    <Icon size={17} aria-hidden="true" />
    <div><strong>{title}</strong><p>{description}</p></div>
  </aside>
}
