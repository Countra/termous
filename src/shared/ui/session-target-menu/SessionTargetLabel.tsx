import { Tooltip } from 'antd'
import { useRef, useState } from 'react'
import uiStyles from '../Primitives.module.scss'

export function SessionTargetLabel({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  return <Tooltip title={text} open={open} onOpenChange={(next) => {
    setOpen(Boolean(next && ref.current && ref.current.scrollWidth > ref.current.clientWidth))
  }} placement="topLeft" arrow={false} mouseEnterDelay={0.4} mouseLeaveDelay={0} destroyOnHidden
    classNames={{ root: `${uiStyles.tooltip} termous-tooltip` }}>
    <span ref={ref} onClick={() => setOpen(false)}>{text}</span>
  </Tooltip>
}
