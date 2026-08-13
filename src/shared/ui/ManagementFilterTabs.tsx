import { Tabs, type TabsProps } from 'antd'
import styles from './ManagementFilterTabs.module.scss'

export function ManagementFilterTabs({ className, ...props }: TabsProps) {
  const classes = [styles.root, className].filter(Boolean).join(' ')
  return <Tabs {...props} className={classes} />
}
