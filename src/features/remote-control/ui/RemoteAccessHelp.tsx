import type { ReactNode } from 'react'
import { Button, Tooltip } from 'antd'
import { Info } from 'lucide-react'
import styles from './RemoteAccessHelp.module.scss'

export function RemoteAccessHelp({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip trigger={['hover', 'focus']} styles={{ root: { maxWidth: 320 } }}
    title={<div className={styles.content}>{children}</div>}>
    <Button type="text" size="small" className={styles.trigger} aria-label={label} icon={<Info size={14} aria-hidden="true" />} />
  </Tooltip>
}
