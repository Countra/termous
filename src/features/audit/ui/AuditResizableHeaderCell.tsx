import { useEffect, useRef, useState, type HTMLAttributes, type MouseEvent } from 'react'
import styles from './AuditWorkspace.module.scss'

export interface AuditResizableHeaderCellProps extends HTMLAttributes<HTMLTableCellElement> {
  resizeLabel?: string
  columnWidth?: number
  minimumWidth?: number
  maximumWidth?: number
  resizeFromStart?: boolean
  onColumnResize?: (width: number) => void
}

export function AuditResizableHeaderCell({ resizeLabel, columnWidth, minimumWidth = 90, maximumWidth = 640, resizeFromStart, onColumnResize, onClick, children, ...props }: AuditResizableHeaderCellProps) {
  const cleanupRef = useRef<(() => void) | null>(null)
  const suppressClick = useRef(false)
  const clickReset = useRef<number | undefined>(undefined)
  const [resizing, setResizing] = useState(false)
  useEffect(() => () => { cleanupRef.current?.(); window.clearTimeout(clickReset.current) }, [])

  const clamp = (width: number) => Math.min(maximumWidth, Math.max(minimumWidth, Math.round(width)))
  const beginResize = (event: MouseEvent<HTMLSpanElement>) => {
    if (event.button !== 0 || !onColumnResize || columnWidth === undefined) return
    event.preventDefault()
    event.stopPropagation()
    cleanupRef.current?.()
    window.clearTimeout(clickReset.current)
    suppressClick.current = true
    const startX = event.clientX
    const startWidth = event.currentTarget.closest('th')?.getBoundingClientRect().width || columnWidth
    let nextWidth = startWidth
    let frame: number | undefined
    const apply = () => { frame = undefined; onColumnResize(clamp(nextWidth)) }
    const move = (moveEvent: globalThis.MouseEvent) => {
      moveEvent.preventDefault()
      nextWidth = startWidth + (moveEvent.clientX - startX) * (resizeFromStart ? -1 : 1)
      if (frame === undefined) frame = window.requestAnimationFrame(apply)
    }
    const cleanup = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', finish)
      window.removeEventListener('blur', finish)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      cleanupRef.current = null
    }
    const finish = () => {
      cleanup()
      apply()
      setResizing(false)
      // 松手落在表头时浏览器可能合成 click；只屏蔽本次拖拽产生的点击。
      clickReset.current = window.setTimeout(() => { suppressClick.current = false }, 0)
    }
    window.addEventListener('mousemove', move, { passive: false })
    window.addEventListener('mouseup', finish, { once: true })
    window.addEventListener('blur', finish, { once: true })
    cleanupRef.current = cleanup
    setResizing(true)
  }

  return (
    <th {...props} onClick={(event) => {
      if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); return }
      onClick?.(event)
    }}>
      {children}
      {onColumnResize && columnWidth !== undefined ? <span
        className={styles['column-resizer']}
        data-resizing={resizing || undefined}
        data-from-start={resizeFromStart || undefined}
        role="separator"
        aria-orientation="vertical"
        aria-label={resizeLabel}
        aria-valuenow={columnWidth}
        aria-valuemin={minimumWidth}
        aria-valuemax={maximumWidth}
        aria-valuetext={`${columnWidth}px`}
        tabIndex={0}
        onMouseDown={beginResize}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          // 分隔条的键盘操作不能冒泡到 AntD 表头并触发排序。
          event.stopPropagation()
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          const direction = (event.key === 'ArrowLeft' ? -1 : 1) * (resizeFromStart ? -1 : 1)
          onColumnResize(clamp(columnWidth + direction * (event.shiftKey ? 48 : 16)))
        }}
      /> : null}
    </th>
  )
}
