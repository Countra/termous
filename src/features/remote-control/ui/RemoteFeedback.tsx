import type { ReactNode } from 'react'
import { Button } from 'antd'
import { CircleAlert, Info, X } from 'lucide-react'
import styles from './RemoteFeedback.module.scss'

export function RemoteFeedback({ title, message, action, onClose, closeLabel, tone = 'warning' }: {
  title?: string
  message: string
  action?: ReactNode
  onClose?: () => void
  closeLabel?: string
  tone?: 'warning' | 'info'
}) {
  return <div className={styles.notice} role={tone === 'warning' ? 'alert' : 'status'}>
    <span className={styles.icon} data-tone={tone}>{tone === 'warning' ? <CircleAlert size={17} /> : <Info size={17} />}</span>
    <div className={styles.content}>{title ? <strong>{title}</strong> : null}<p>{message}</p>{action ? <div className={styles.actions}>{action}</div> : null}</div>
    {onClose ? <Button className={styles.close} type="text" size="small" icon={<X size={14} />} aria-label={closeLabel} onClick={onClose} /> : null}
  </div>
}

export function RemoteFeedbackStack({ children, inline = false }: { children: ReactNode; inline?: boolean }) {
  return <div className={`${styles.stack} ${inline ? styles.inline : ''}`}>{children}</div>
}
