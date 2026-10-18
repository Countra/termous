import { ChevronRight } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import styles from './SettingsGroup.module.scss'

export function SettingsGroup({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  const id = useId()
  return <section className={styles.group} aria-labelledby={id}>
    <h3 id={id} className={styles.heading}>{icon}{title}</h3>
    <div className={styles.fields}>{children}</div>
  </section>
}

export function SettingsField({ label, htmlFor, description, descriptionId, control, children }: {
  label: string
  htmlFor: string
  description: string
  descriptionId: string
  control: ReactNode
  children?: ReactNode
}) {
  return <div className={styles.field}>
    <div className={styles.copy}>
      <label htmlFor={htmlFor}>{label}</label>
      <p id={descriptionId}>{description}</p>
    </div>
    <div className={styles.control}>{control}</div>
    {children && <div className={styles.extra}>{children}</div>}
  </div>
}

export function SettingsDetails({ summary, children }: { summary: string; children: ReactNode }) {
  return <details className={styles.details}>
    <summary><ChevronRight size={13} aria-hidden="true" />{summary}</summary>
    <div>{children}</div>
  </details>
}
