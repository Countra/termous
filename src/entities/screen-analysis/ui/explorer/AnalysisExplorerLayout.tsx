import { Button, Tooltip } from 'antd'
import { History, ListFilter } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Group, Panel, Separator, useGroupRef } from 'react-resizable-panels'
import { type AnalysisPresentation } from '#common/contracts'
import { analysisSeparatorWidth, defaultAnalysisPanels, explorerLayout, type AnalysisPane } from '../../model/explorerLayout'
import styles from './AnalysisExplorerLayout.module.scss'

export function AnalysisExplorerLayout({ state, onChange, pane, onPane, history, results, children }: {
  state: AnalysisPresentation; onChange: (patch: Partial<AnalysisPresentation>) => void
  pane: AnalysisPane; onPane: (pane: AnalysisPane) => void; history: ReactNode; results: ReactNode; children: ReactNode
}) {
  const { t } = useTranslation()
  const root = useRef<HTMLDivElement>(null)
  const element = useRef<HTMLDivElement>(null)
  const tabs = useRef<HTMLDivElement>(null)
  const group = useGroupRef()
  const [width, setWidth] = useState(1200)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => { if (entry?.contentRect.width > 0) setWidth(entry.contentRect.width) })
    if (root.current) observer.observe(root.current)
    return () => observer.disconnect()
  }, [])
  const preferred = state.panels ?? defaultAnalysisPanels
  const { compact, active, expanded, limits, centerMin, sizes } = explorerLayout(width, preferred, state.history, state.resultsVisible !== false, pane)
  const { canvas, sidebar } = sizes
  useEffect(() => {
    // 子面板完成约束登记后再恢复布局，避免收起再展开丢失用户宽度。
    const frame = requestAnimationFrame(() => group.current?.setLayout({ 'analysis-canvas': canvas, 'analysis-sidebar': sidebar }))
    return () => cancelAnimationFrame(frame)
  }, [group, canvas, sidebar])
  const select = (next: 'history' | 'results') => {
    const closing = active === next
    onPane(closing ? 'canvas' : next)
    onChange({ history: !closing && next === 'history', resultsVisible: !closing })
  }
  return <div ref={root} className={styles.layout} data-analysis-layout data-mobile={active} data-compact={compact || undefined}>
    <Group groupRef={group} elementRef={element} className={styles.group} disabled={compact} resizeTargetMinimumSize={{ fine: 8, coarse: 20 }} onLayoutChanged={(next, meta) => {
      if (!meta.isUserInteraction || compact || !expanded || !element.current) return
      const available = element.current.getBoundingClientRect().width - analysisSeparatorWidth
      if (available <= 0) return
      const size = Math.round(Math.max(limits.min, Math.min(limits.max, next['analysis-sidebar'] / 100 * available)))
      const key = active === 'history' ? 'historyWidth' : 'resultsWidth'
      if (size !== preferred[key]) onChange({ panels: { ...preferred, [key]: size } })
    }}>
      <Panel id="analysis-canvas" className={styles.canvas} minSize={centerMin} maxSize={compact && expanded ? 0 : '100%'} defaultSize={canvas + '%'} inert={compact && expanded} aria-hidden={compact && expanded}>{children}</Panel>
      <Separator className={styles.separator} data-hidden={compact || !expanded || undefined} disabled={compact || !expanded} disableDoubleClick
        aria-label={t(`desktopWorkflow.analysisWorkspace.resize${active === 'history' ? 'History' : 'Results'}`)} title={t('desktopWorkflow.analysisWorkspace.resizeHint')}
        onDoubleClick={() => onChange({ panels: { ...preferred, [active === 'history' ? 'historyWidth' : 'resultsWidth']: limits.default } })} />
      <Panel id="analysis-sidebar" className={styles.panel} minSize={expanded ? compact ? '100%' : limits.min : 0} maxSize={expanded ? compact ? '100%' : limits.max : 0} defaultSize={sidebar + '%'} inert={!expanded} aria-hidden={!expanded}>
        {expanded && <aside id={`analysis-${active}`} className={styles.content} role="tabpanel" aria-labelledby={`analysis-tab-${active}`}>{active === 'history' ? history : results}</aside>}
      </Panel>
    </Group>
    <div ref={tabs} className={styles.tabs} role="tablist" aria-orientation="vertical" aria-label={t('desktopWorkflow.analysisWorkspace.title')} onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const items = Array.from(tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      event.preventDefault(); items[next]?.focus()
    }}>
      {(['results', 'history'] as const).map(side => {
        const selected = active === side
        const label = t(`desktopWorkflow.analysisWorkspace.${selected ? 'collapse' : 'expand'}${side === 'history' ? 'History' : 'Results'}`)
        return <Tooltip key={side} title={label} placement="left"><Button id={`analysis-tab-${side}`} className={styles.tab} type="text" role="tab"
          aria-label={label} aria-selected={selected} aria-expanded={selected} aria-controls={selected ? `analysis-${side}` : undefined}
          tabIndex={selected || !expanded && side === 'results' ? 0 : -1} onClick={() => select(side)}>
          {side === 'history' ? <History size={17} /> : <ListFilter size={17} />}<span>{t(`desktopWorkflow.analysisWorkspace.${side}`)}</span>
        </Button></Tooltip>
      })}
    </div>
  </div>
}
