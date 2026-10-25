import { Dropdown } from 'antd'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useEffect, useRef, type ReactNode } from 'react'
import { contextActionMenuPopupClassName } from '#shared/ui'
import type { CandidateMenu } from '../../model/useCanvasSelection'
import styles from './Candidates.module.scss'

function CandidatePopup({ children, onHover, onClose }: { children: ReactNode; onHover: (id?: number) => void; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // 等本次指针点击派发完再交接焦点，避免视口的点击焦点覆盖菜单。
    const frame = requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [])
  return <div ref={root} onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
    onFocusCapture={e => {
      const value = (e.target as HTMLElement).closest('[role="menuitem"]')?.querySelector<HTMLElement>('[data-analysis-id]')?.dataset.analysisId
      if (value !== undefined) onHover(Number(value))
    }} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onClose() } }}>{children}</div>
}

export function AnalysisCandidates({ menu, selected, onSelect, onHover, onClose }: {
  menu: CandidateMenu; selected?: number; onSelect: (id: number) => void; onHover: (id?: number) => void; onClose: () => void
}) {
  const { t } = useTranslation()
  return <Dropdown open autoFocus trigger={['click']} placement="bottomLeft" onOpenChange={open => { if (!open) onClose() }}
    classNames={{ root: `${contextActionMenuPopupClassName} ${styles.popup}` }}
    popupRender={content => <CandidatePopup onHover={onHover} onClose={onClose}>{content}</CandidatePopup>}
    menu={{ selectable: true, selectedKeys: selected === undefined ? [] : [String(selected)], rootClassName: contextActionMenuPopupClassName,
      'aria-label': t('desktopWorkflow.analysisWorkspace.chooseResult'),
      onClick: ({ key }) => { onSelect(Number(key)); onClose() },
      items: [{ type: 'group', key: 'matches',
        label: <span className={styles.heading}><span>{t('desktopWorkflow.analysisWorkspace.chooseResult')}</span><span>{t('desktopWorkflow.analysisWorkspace.overlapCount', { count: menu.items.length })}</span></span>,
        children: menu.items.map(item => ({
          key: String(item.id),
          onMouseEnter: () => onHover(item.id), onMouseLeave: () => onHover(undefined),
          label: <span className={styles.item} data-analysis-id={item.id} data-selected={selected === item.id}>
            <span className={styles.number}><span>#</span>{item.id}</span>
            <span className={styles.kind}>{t(item.element_id === undefined ? `desktopWorkflow.analysis.${item.kind}` : 'desktopWorkflow.analysisWorkspace.ocr')}</span>
            <span className={styles.dimensions}>{item.bbox_xyxy[2] - item.bbox_xyxy[0]} × {item.bbox_xyxy[3] - item.bbox_xyxy[1]} <span>px</span></span>
            <Check className={styles.check} size={14} strokeWidth={2} aria-hidden="true" />
          </span>,
        })) }] }}>
    <span className={styles.anchor} style={{ left: menu.x, top: menu.y }} />
  </Dropdown>
}
