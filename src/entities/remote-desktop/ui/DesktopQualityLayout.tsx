import { useId, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import styles from './DesktopPresentationControls.module.scss'

export function DesktopQualityField({ label, description, children }: {
  label: string
  description?: string
  children(attributes: { id: string; 'aria-describedby'?: string }): ReactNode
}) {
  const id = useId()
  const hintId = description ? `${id}-hint` : undefined
  return <div className={styles.field}>
    <label htmlFor={id}>{label}</label>
    <div className={styles.control}>{children({ id, 'aria-describedby': hintId })}</div>
    {description && <p id={hintId}>{description}</p>}
  </div>
}

export function DesktopQualityDetails({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <details className={styles.details}>
    <summary><ChevronRight size={14} aria-hidden="true" /><span>{title}</span></summary>
    <div className={styles['details-body']}>
      {description && <p className={styles['section-hint']}>{description}</p>}
      {children}
    </div>
  </details>
}
