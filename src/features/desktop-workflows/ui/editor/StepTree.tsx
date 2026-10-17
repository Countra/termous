import { Button, Dropdown, Tooltip } from 'antd'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, GripVertical, MoreHorizontal, Power, Trash2, Workflow } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Step, StepKind } from '#entities/desktop-workflow'
import { AddStepMenu } from './AddStepMenu'
import { stepIcons, stepLabel, stepSummary } from '../shared/stepPresentation'
import overlays from '../shared/WorkflowOverlays.module.scss'
import styles from './StepTree.module.scss'

interface Props {
  steps: Step[]; selected?: string; onSelect: (id: string) => void
  onAdd: (kind: StepKind, parent?: string, branch?: 'steps' | 'else') => void
  onMove: (id: string, delta: number) => void; onCopy: (id: string) => void
  onRemove: (id: string) => void; onToggle: (id: string, disabled: boolean) => void
  foldedSteps?: string[]; onFoldChange?: (ids: string[]) => void
}
export function StepTree(props: Props) {
  const { t } = useTranslation()
  const [drag, setDrag] = useState<string>()
  const [drop, setDrop] = useState<string>()
  const [localFolded, setLocalFolded] = useState<string[]>([])
  const folded = new Set(props.foldedSteps ?? localFolded)
  const toggleBranch = (id: string) => {
    const next = new Set(folded)
    if (next.has(id)) next.delete(id); else next.add(id)
    if (props.onFoldChange) props.onFoldChange([...next]); else setLocalFolded([...next])
  }
  const list = (steps: Step[], depth: number) => <ol className={styles.steps}>
    {steps.map((step, index) => {
      const Icon = stepIcons[step.kind]
      const label = stepLabel(step.kind, t)
      const summary = stepSummary(step, t)
      const branching = (step.kind === 'if' || step.kind === 'repeat') && depth < 8
      const collapsed = folded.has(step.id)
      return <li key={step.id} className={styles.node}>
        <div className={styles.step} data-selected={props.selected === step.id || undefined} data-disabled={step.disabled || undefined} data-dragging={drag === step.id || undefined} data-drop={drop === step.id ? steps.findIndex(item => item.id === drag) > index ? 'before' : 'after' : undefined}
          onDragOver={(event) => { if (drag && drag !== step.id && steps.some((item) => item.id === drag)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDrop(step.id) } }}
          onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDrop(undefined) }}
          onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const source = steps.findIndex((item) => item.id === drag); if (source >= 0 && source !== index) props.onMove(drag!, index - source); setDrag(undefined); setDrop(undefined) }}>
          <span className={styles.grip} draggable title={t('desktopWorkflow.dragStep')} onDragStart={(event) => { setDrag(step.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', step.id) }} onDragEnd={() => { setDrag(undefined); setDrop(undefined) }} aria-hidden="true"><GripVertical size={14} /></span>
          <button type="button" className={styles['step-label']} aria-current={props.selected === step.id ? 'step' : undefined} onClick={() => props.onSelect(step.id)}>
            <span className={styles['step-icon']}><Icon size={16} /></span>
            <span className={styles['step-text']}><strong title={step.name || label}>{step.name || label}</strong><span className={styles['step-meta']}><span className={styles.number}>{String(index + 1).padStart(2, '0')}</span><span>{summary}</span></span></span>
          </button>
          <Dropdown trigger={['click']} placement="bottomRight" classNames={{ root: overlays.menu }} menu={{ items: [
            { key: 'toggle', label: t(step.disabled ? 'desktopWorkflow.enableStep' : 'desktopWorkflow.disableStep'), icon: <Power size={14} />, onClick: () => props.onToggle(step.id, !step.disabled) },
            { type: 'divider' },
            { key: 'up', label: t('desktopWorkflow.moveUp'), icon: <ArrowUp size={14} />, disabled: index === 0, onClick: () => props.onMove(step.id, -1) },
            { key: 'down', label: t('desktopWorkflow.moveDown'), icon: <ArrowDown size={14} />, disabled: index === steps.length - 1, onClick: () => props.onMove(step.id, 1) },
            { key: 'copy', label: t('desktopWorkflow.copy'), icon: <Copy size={14} />, onClick: () => props.onCopy(step.id) },
            { type: 'divider' },
            { key: 'delete', danger: true, label: t('desktopWorkflow.delete'), icon: <Trash2 size={14} />, onClick: () => props.onRemove(step.id) },
          ] }}><Button type="text" size="small" className={styles.more} aria-label={t('desktopWorkflow.stepActions', { name: step.name || stepLabel(step.kind, t) })} icon={<MoreHorizontal size={15} />} /></Dropdown>
        </div>
        {branching && <>
          <button type="button" className={styles['branch-toggle']} aria-expanded={!collapsed} onClick={() => toggleBranch(step.id)}>{collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}{t(step.kind === 'if' ? 'desktopWorkflow.condition' : 'desktopWorkflow.loopBody')}<span>{(step.steps?.length ?? 0) + (step.else?.length ?? 0)}</span></button>
          <div className={styles.branch} hidden={collapsed}>
            <div className={styles['branch-header']}><span>{t(step.kind === 'if' ? 'desktopWorkflow.whenMatched' : 'desktopWorkflow.loopBody')}</span><AddStepMenu compact onAdd={(kind) => props.onAdd(kind, step.id, 'steps')} /></div>
            {list(step.steps ?? [], depth + 1)}
            {step.kind === 'if' && <><div className={styles['branch-header']}><span>{t('desktopWorkflow.otherwise')}</span><AddStepMenu compact onAdd={(kind) => props.onAdd(kind, step.id, 'else')} /></div>{list(step.else ?? [], depth + 1)}</>}
          </div>
        </>}
      </li>
    })}
  </ol>
  return <section className={styles['step-panel']} aria-label={t('desktopWorkflow.steps')}>
    <header className={styles['panel-header']}><div><Workflow size={15} /><strong>{t('desktopWorkflow.executionChain')}</strong><span>{props.steps.length}</span></div><AddStepMenu onAdd={(kind) => props.onAdd(kind)} /></header>
    <div className={styles.scroll}>{props.steps.length ? list(props.steps, 1) : <div className={styles.empty}><Workflow size={28} strokeWidth={1.3} /><strong>{t('desktopWorkflow.addFirstStep')}</strong><p>{t('desktopWorkflow.chainHint')}</p></div>}</div>
    <Tooltip title={t('desktopWorkflow.chainHint')}><footer className={styles.footer}>{t('desktopWorkflow.chainFooter')}</footer></Tooltip>
  </section>
}
