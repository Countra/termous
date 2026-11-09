import { Button, Segmented, Tooltip } from 'antd'
import { ChevronLeft, ChevronRight, Monitor, PanelLeft, PanelRight } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Group, Panel, Separator, useGroupRef } from 'react-resizable-panels'
import { workflowPanelLimits } from '#common/contracts'
import { defaultEditorPanels, editorLayout, editorSeparatorWidth, type EditorPanel } from '../../model/editorLayout'
import type { WorkflowPresentation } from '../../model/workspace/types'
import styles from './WorkflowEditorLayout.module.scss'

interface Props {
  width: number; busy: boolean; presentation: WorkflowPresentation
  onPresentation: (patch: Partial<WorkflowPresentation>) => void
  chain: (onCollapse: () => void, onSelected: () => void) => ReactNode
  properties: ReactNode; children: ReactNode
}

export function WorkflowEditorLayout({ width, busy, presentation, onPresentation, chain, properties, children }: Props) {
  const { t } = useTranslation()
  const group = useGroupRef()
  const element = useRef<HTMLDivElement>(null)
  const controls = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<'chain' | 'details' | undefined>(undefined)
  const [selected, setSelected] = useState<EditorPanel>('canvas')
  const preferred = presentation.editorPanels ?? defaultEditorPanels
  const layout = editorLayout(width, preferred, !!presentation.chainCollapsed, presentation.propertiesVisible, selected)
  const { chainDocked, detailsDocked, compact, centerMin } = layout
  const { chain: chainSize, canvas: canvasSize, details: detailsSize } = layout.sizes
  useEffect(() => {
    // 等待分栏库完成约束更新后恢复尺寸；隐藏画布只改变可见性，不销毁预览租约。
    const frame = requestAnimationFrame(() => {
      const current = group.current
      if (current) {
        const sizes: Record<string, number> = { chain: chainSize, canvas: canvasSize, details: detailsSize }
        // 零宽面板重新注册后顺序可能变化；库按键顺序套用约束，必须沿用当前布局顺序。
        const ids = Object.keys(current.getLayout())
        if (ids.length === 3 && ids.every(id => id in sizes)) current.setLayout(Object.fromEntries(ids.map(id => [id, sizes[id]])))
      }
      if (pendingFocus.current) {
        controls.current?.querySelector<HTMLButtonElement>(`button[data-panel-toggle="${pendingFocus.current}"]`)?.focus()
        pendingFocus.current = undefined
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [group, chainSize, canvasSize, detailsSize])
  const collapse = (side: 'chain' | 'details') => {
    if (compact) { setSelected('canvas'); return }
    pendingFocus.current = side
    onPresentation(side === 'chain' ? { chainCollapsed: true } : { propertiesVisible: false })
  }
  const reset = (side: 'chain' | 'details') => onPresentation({ editorPanels: { ...preferred, [`${side}Width`]: workflowPanelLimits[side].default } })
  const separator = (side: 'chain' | 'details', visible: boolean) => <Separator className={styles.separator} data-hidden={compact || !visible || undefined} disabled={compact || !visible} disableDoubleClick
    aria-label={t(side === 'chain' ? 'desktopWorkflow.resizeChain' : 'desktopWorkflow.resizeProperties')} title={t('desktopWorkflow.resizePanelHint')} onDoubleClick={() => reset(side)} />
  return <div className={styles.layout} inert={busy} data-workflow-editor-layout data-compact={compact || undefined}>
    <div ref={controls} className={styles.controls}>
      {compact ? <Segmented block aria-label={t('desktopWorkflow.editorPanels')} value={selected} onChange={setSelected} options={[
        { value: 'chain', label: t('desktopWorkflow.executionChain'), icon: <PanelLeft size={14} /> },
        { value: 'canvas', label: t('desktopWorkflow.editorCanvas'), icon: <Monitor size={14} /> },
        { value: 'details', label: t('desktopWorkflow.properties'), icon: <PanelRight size={14} /> },
      ]} /> : <>
        <Button type="text" className={styles.toggle} data-panel-toggle="chain" data-active={chainDocked || undefined} aria-expanded={chainDocked} aria-label={t('desktopWorkflow.executionChain')} title={t(chainDocked ? 'desktopWorkflow.collapseChain' : 'desktopWorkflow.expandChain')} icon={<PanelLeft size={14} />} onClick={() => onPresentation({ chainCollapsed: chainDocked })}>{t('desktopWorkflow.executionChain')}<ChevronLeft size={12} className={styles.chevron} /></Button>
        <Button type="text" className={styles.toggle} data-panel-toggle="details" data-active={detailsDocked || undefined} aria-expanded={detailsDocked} aria-label={t('desktopWorkflow.properties')} title={t(detailsDocked ? 'desktopWorkflow.collapseProperties' : 'desktopWorkflow.expandProperties')} icon={<PanelRight size={14} />} onClick={() => onPresentation({ propertiesVisible: !detailsDocked })}>{t('desktopWorkflow.properties')}<ChevronRight size={12} className={styles.chevron} /></Button>
      </>}
    </div>
    <Group groupRef={group} elementRef={element} className={styles.group} disabled={busy || compact} resizeTargetMinimumSize={{ fine: 8, coarse: 20 }} onLayoutChanged={(sizes, meta) => {
      // 窗口适配和标签切换不写回偏好，拖动结束才同步跨窗口状态。
      if (!meta.isUserInteraction || compact || !element.current) return
      const available = element.current.getBoundingClientRect().width - editorSeparatorWidth * layout.separatorCount
      if (available <= 0) return
      const size = (side: 'chain' | 'details') => Math.round(Math.min(workflowPanelLimits[side].max, Math.max(workflowPanelLimits[side].min, sizes[side] / 100 * available)))
      const next = { chainWidth: chainDocked ? size('chain') : preferred.chainWidth, detailsWidth: detailsDocked ? size('details') : preferred.detailsWidth }
      if (next.chainWidth !== preferred.chainWidth || next.detailsWidth !== preferred.detailsWidth) onPresentation({ editorPanels: next })
    }}>
      <Panel id="chain" minSize={compact ? chainDocked ? '100%' : 0 : chainDocked ? workflowPanelLimits.chain.min : 0} maxSize={compact ? chainDocked ? '100%' : 0 : chainDocked ? workflowPanelLimits.chain.max : 0} defaultSize={layout.chainWidth} className={styles.panel} inert={!chainDocked} aria-hidden={!chainDocked}>
        {chainDocked && <div className={styles.content}>{chain(() => collapse('chain'), () => { if (compact) setSelected('canvas') })}</div>}
      </Panel>
      {separator('chain', chainDocked)}
      <Panel id="canvas" minSize={compact ? selected === 'canvas' ? '100%' : 0 : centerMin} maxSize={compact && selected !== 'canvas' ? 0 : '100%'} className={styles.panel} inert={compact && selected !== 'canvas'} aria-hidden={compact && selected !== 'canvas'}>{children}</Panel>
      {separator('details', detailsDocked)}
      <Panel id="details" minSize={compact ? detailsDocked ? '100%' : 0 : detailsDocked ? workflowPanelLimits.details.min : 0} maxSize={compact ? detailsDocked ? '100%' : 0 : detailsDocked ? workflowPanelLimits.details.max : 0} defaultSize={layout.detailsWidth} className={styles.panel} inert={!detailsDocked} aria-hidden={!detailsDocked}>
        {detailsDocked && <aside className={styles.properties} aria-label={t('desktopWorkflow.properties')}><header className={styles.header}>
          <PanelRight size={14} /><strong>{t('desktopWorkflow.properties')}</strong><Tooltip title={t(compact ? 'desktopWorkflow.backToCanvas' : 'desktopWorkflow.collapseProperties')}><Button type="text" size="small" aria-label={t('desktopWorkflow.collapseProperties')} icon={<ChevronRight size={15} />} onClick={() => collapse('details')} /></Tooltip>
        </header><div className={styles['property-content']}>{properties || <p className={styles.hint}>{t('desktopWorkflow.selectStep')}</p>}</div></aside>}
      </Panel>
    </Group>
  </div>
}
