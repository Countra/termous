import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBytes } from '#shared/format'
import styles from './TransferSummary.module.scss'

interface Props {
  count: number
  progress?: number
  speed?: number
  scopeKey: string
}

// 仅合并摘要数值；任务状态、操作按钮和运行时数据仍即时更新。
export function TransferSummary({ scopeKey, ...props }: Props) {
  return <Summary key={scopeKey} {...props} />
}

function Summary({ count, progress, speed }: Omit<Props, 'scopeKey'>) {
  const { t } = useTranslation()
  const latest = useRef({ progress, speed })
  const [display, setDisplay] = useState({ progress, speed })
  useEffect(() => { latest.current = { progress, speed } }, [progress, speed])
  useEffect(() => {
    // 连续进度不会停止，采用定时合并而非等待静默，避免防抖导致一直不刷新。
    const timer = window.setInterval(() => {
      const next = latest.current
      setDisplay((current) => current.progress === next.progress && current.speed === next.speed ? current : next)
    }, 600)
    return () => window.clearInterval(timer)
  }, [])
  const label = t('files.activeTransferCount', { count })
  const percentage = progress === undefined ? '' : `${Math.round(display.progress ?? progress)}%`
  const rate = speed === undefined ? '' : t('files.transferSpeed', { value: formatBytes(display.speed ?? speed) })
  return <span className={styles.summary}>
    <span className={styles.label} title={label}>{label}</span>
    <b className={styles.number} title={percentage}>{percentage}</b>
    <b className={styles.number} title={rate}>{rate}</b>
  </span>
}
