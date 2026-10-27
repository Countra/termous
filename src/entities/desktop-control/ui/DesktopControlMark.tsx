import { Bot, Monitor, MousePointer2, Workflow } from 'lucide-react'
import styles from './desktopControl.module.scss'

export function DesktopControlMark({ source, size = 15 }: { source: string; size?: number }) {
  const Icon = source === 'agent' ? Bot : source === 'workflow' ? Workflow : source === 'remote' ? Monitor : MousePointer2
  return <Icon className={styles.mark} size={size} aria-hidden="true" />
}
