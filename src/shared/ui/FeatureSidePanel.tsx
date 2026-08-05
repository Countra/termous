import { Button, Tabs, Tooltip } from 'antd'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react'

export interface FeatureSidePanelTab<Key extends string> {
  key: Key
  label: ReactNode
  icon: ReactNode
  children: ReactNode
}

interface FeatureSidePanelProps<Key extends string> {
  activeKey: Key
  ariaLabel: string
  collapsed: boolean
  collapseLabel: string
  expandLabel: string
  tabs: FeatureSidePanelTab<Key>[]
  className?: string
  popupClassName?: string
  resizing?: boolean
  onActiveKeyChange: (key: Key) => void
  onCollapsedChange: (next: boolean) => void
  onResizePointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void
}

export function FeatureSidePanel<Key extends string>({
  activeKey,
  ariaLabel,
  collapsed,
  collapseLabel,
  expandLabel,
  tabs,
  className,
  popupClassName = 'details-tabs-dropdown',
  resizing = false,
  onActiveKeyChange,
  onCollapsedChange,
  onResizePointerDown,
}: FeatureSidePanelProps<Key>) {
  const classes = ['details-panel', 'feature-side-panel', className, collapsed ? 'is-collapsed' : '', resizing ? 'is-resizing' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <aside className={classes}>
      {onResizePointerDown ? <div className="details-resize-edge" aria-hidden="true" onPointerDown={onResizePointerDown} /> : null}
      <Tooltip title={collapsed ? expandLabel : collapseLabel}>
        <Button
          type="text"
          className="panel-side-toggle panel-side-toggle-right"
          onClick={() => onCollapsedChange(!collapsed)}
          aria-label={collapsed ? expandLabel : collapseLabel}
          icon={collapsed ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        />
      </Tooltip>
      {collapsed ? (
        <div className="details-collapsed-rail" aria-label={ariaLabel}>
          {tabs.map((item) => (
            <Tooltip key={item.key} title={item.label} placement="left">
              <Button
                type="text"
                className={`details-rail-tab ${activeKey === item.key ? 'is-active' : ''}`}
                aria-label={String(item.label)}
                icon={item.icon}
                onClick={() => {
                  onActiveKeyChange(item.key)
                  onCollapsedChange(false)
                }}
              />
            </Tooltip>
          ))}
        </div>
      ) : null}
      <div className={`details-content-shell ${collapsed ? 'is-hidden' : ''}`} aria-hidden={collapsed}>
        <Tabs
          className="details-tabs"
          classNames={{ popup: { root: popupClassName } }}
          size="small"
          activeKey={activeKey}
          destroyOnHidden={false}
          onChange={(key) => onActiveKeyChange(key as Key)}
          items={tabs.map((item) => ({
            key: item.key,
            label: item.label,
            children: item.children,
          }))}
        />
      </div>
    </aside>
  )
}
