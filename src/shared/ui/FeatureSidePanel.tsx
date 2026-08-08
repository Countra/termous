import { Button, Tabs, Tooltip } from 'antd'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import styles from './FeatureSidePanel.module.scss'

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

const legacyPopupClassName = 'details-tabs-dropdown'

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
  const popupRootClassName = [
    popupClassName.split(/\s+/u).includes(legacyPopupClassName)
      ? styles['details-tabs-dropdown']
      : '',
    popupClassName,
  ]
    .filter(Boolean)
    .join(' ')
  const classes = [
    styles['details-panel'],
    'details-panel',
    'feature-side-panel',
    className,
    collapsed ? `${styles['is-collapsed']} is-collapsed` : '',
    resizing ? 'is-resizing' : '',
  ]
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
        <div className={`${styles['details-collapsed-rail']} details-collapsed-rail`} aria-label={ariaLabel}>
          {tabs.map((item) => (
            <Tooltip key={item.key} title={item.label} placement="left">
              <Button
                type="text"
                className={[
                  styles['details-rail-tab'],
                  'details-rail-tab',
                  activeKey === item.key ? `${styles['is-active']} is-active` : '',
                ].filter(Boolean).join(' ')}
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
      <div
        className={[
          styles['details-content-shell'],
          'details-content-shell',
          collapsed ? `${styles['is-hidden']} is-hidden` : '',
        ].filter(Boolean).join(' ')}
        aria-hidden={collapsed}
      >
        <Tabs
          className={`${styles['details-tabs']} details-tabs`}
          classNames={{ popup: { root: popupRootClassName } }}
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
