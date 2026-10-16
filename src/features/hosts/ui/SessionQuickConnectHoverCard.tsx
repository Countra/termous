import { Tooltip } from 'antd'
import { cloneElement, useEffect, useId, useState, type ReactElement, type ReactNode } from 'react'
import styles from './SessionQuickConnectDetails.module.scss'

interface Props {
  children: ReactElement<{ 'aria-describedby'?: string }>
  content: ReactNode
  active: boolean
  resetKey: string
  unavailableLabel?: string
}

export function SessionQuickConnectHoverCard({
  children, content, active, resetKey, unavailableLabel,
}: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const visible = active && open

  useEffect(() => {
    setOpen(false)
  }, [active, resetKey])

  useEffect(() => {
    if (!visible) return
    const close = () => setOpen(false)
    // 列表与外层工作区滚动时都收起详情，避免浮卡脱离对应的连接项。
    window.addEventListener('scroll', close, true)
    return () => window.removeEventListener('scroll', close, true)
  }, [visible])

  return (
    <Tooltip id={id} title={content} open={visible} unique={false}
      trigger={['hover', 'focus']} placement="rightTop" arrow={false} autoAdjustOverflow
      mouseEnterDelay={0.3} mouseLeaveDelay={0.08} zIndex={3600} destroyOnHidden
      classNames={{ root: styles.tooltip, container: styles.container }}
      onOpenChange={(next) => setOpen(active && next)}
    >
      <span className={styles.trigger} tabIndex={active && unavailableLabel ? 0 : undefined}
        aria-label={unavailableLabel} aria-disabled={unavailableLabel ? true : undefined}
        onPointerDownCapture={() => setOpen(false)}
        onKeyDownCapture={(event) => { if (event.key === 'Escape') setOpen(false) }}
      >
        {cloneElement(children, { 'aria-describedby': visible ? id : undefined })}
      </span>
    </Tooltip>
  )
}
