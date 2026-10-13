import { Button, Dropdown, Switch, Tooltip } from 'antd'
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { stepKinds, type Step, type StepKind } from '#entities/desktop-workflow'
import styles from './WorkflowWorkspace.module.scss'

interface Props {
  steps: Step[]; selected?: string; onSelect: (id: string) => void
  onAdd: (kind: StepKind, parent?: string, branch?: 'steps' | 'else') => void
  onMove: (id: string, delta: number) => void; onCopy: (id: string) => void
  onRemove: (id: string) => void; onToggle: (id: string, disabled: boolean) => void
}
export function StepTree(props: Props) {
  const { t } = useTranslation()
  const [drag, setDrag] = useState<string>()
  const add = (parent?: string, branch?: 'steps' | 'else') => <Dropdown menu={{ items: stepKinds.map((kind) => ({ key: kind, label: t(`desktopWorkflow.kinds.${kind.replace(/\./g, '_')}`) })), onClick: ({ key }) => props.onAdd(key as StepKind, parent, branch) }} trigger={['click']}>
    <Button size="small" icon={<Plus size={14} />}>{t('desktopWorkflow.addStep')}</Button>
  </Dropdown>
  const list = (steps: Step[], depth: number) => <ol className={styles.steps}>
    {steps.map((step, index) => <li key={step.id}>
      <div className={`${styles.step} ${props.selected === step.id ? styles.selected : ''}`} data-disabled={step.disabled || undefined}
        onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const source = steps.findIndex((item) => item.id === drag); if (source >= 0) props.onMove(drag!, index - source); setDrag(undefined) }}>
        <span className={styles.grip} draggable onDragStart={(event) => { setDrag(step.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', step.id) }} onDragEnd={() => setDrag(undefined)} aria-hidden="true"><GripVertical size={14} /></span>
        <button className={styles['step-label']} aria-current={props.selected === step.id ? 'step' : undefined} onClick={() => props.onSelect(step.id)}>
          <span className={styles['step-number']}>{index + 1}</span>
          <span>{step.name || t(`desktopWorkflow.kinds.${step.kind.replace(/\./g, '_')}`)}</span>
        </button>
        <Switch size="small" checked={!step.disabled} aria-label={t('desktopWorkflow.enableStep')} onChange={(checked) => props.onToggle(step.id, !checked)} />
      </div>
      {props.selected === step.id && <div className={styles['step-actions']}>
        {([[ArrowUp, 'moveUp', () => props.onMove(step.id, -1)], [ArrowDown, 'moveDown', () => props.onMove(step.id, 1)], [Copy, 'copy', () => props.onCopy(step.id)], [Trash2, 'delete', () => props.onRemove(step.id)]] as const).map(([Icon, label, handler]) => <Tooltip key={label} title={t(`desktopWorkflow.${label}`)}><Button size="small" type="text" aria-label={t(`desktopWorkflow.${label}`)} onClick={handler} icon={<Icon size={14} />} /></Tooltip>)}
      </div>}
      {(step.kind === 'if' || step.kind === 'repeat') && depth < 8 && <div className={styles.branch}>
        <div className={styles['branch-header']}>{t(step.kind === 'if' ? 'desktopWorkflow.whenMatched' : 'desktopWorkflow.loopBody')}{add(step.id, 'steps')}</div>
        {list(step.steps ?? [], depth + 1)}
        {step.kind === 'if' && <><div className={styles['branch-header']}>{t('desktopWorkflow.otherwise')}{add(step.id, 'else')}</div>{list(step.else ?? [], depth + 1)}</>}
      </div>}
    </li>)}
  </ol>
  return <section className={styles['step-panel']} aria-label={t('desktopWorkflow.steps')}>
    <header className={styles['panel-header']}><strong>{t('desktopWorkflow.steps')}</strong>{add()}</header>
    <div className={styles.scroll}>{props.steps.length ? list(props.steps, 1) : <p className={styles.hint}>{t('desktopWorkflow.addFirstStep')}</p>}</div>
  </section>
}
