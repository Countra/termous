import { Button } from 'antd'
import { Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, CircleDashed, Clock3, Image, LoaderCircle, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Definition, Parameter, Step, StepResult } from '#entities/desktop-workflow'
import type { WorkflowMediaGateway, WorkflowReportExpansion } from '../../model/workspace/types'
import type { ImagePreviewSource } from '#shared/ui'
import { workflowError } from '../../model/messages'
import { stepIcons, stepLabel } from '../shared/stepPresentation'
import { runDuration, runTime, runTone } from '../shared/runPresentation'
import { StepActionDetails } from './StepActionDetails'
import { ExecutionImageCard } from './ExecutionImageCard'
import styles from './RunStepTimeline.module.scss'

type Expansion = Omit<WorkflowReportExpansion, 'runID'>
interface Props {
  steps: StepResult[]; definition?: Definition; gateway: Pick<WorkflowMediaGateway, 'asset'>; onImage: (source: ImagePreviewSource) => void
  expansion?: Expansion; onExpansionChange?: (value: Expansion) => void
}

function Result({ step, configured, parameters, expanded, onToggle, gateway, onImage }: Pick<Props, 'gateway' | 'onImage'> & {
  step: StepResult; configured?: Step; parameters: Parameter[]; expanded: boolean; onToggle: () => void
}) {
  const { t } = useTranslation()
  const failed = !!step.error_code || ['failed', 'uncertain', 'timed_out', 'interrupted'].includes(step.state)
  const complete = ['completed', 'accepted', 'assertion_passed'].includes(step.state)
  const active = ['running', 'dispatching'].includes(step.state)
  const StateIcon = failed ? X : complete ? Check : active ? LoaderCircle : CircleDashed
  const Icon = stepIcons[step.kind] ?? CircleDashed
  return <li className={styles.result} data-tone={runTone(step.state)}>
    <span className={styles.marker}><StateIcon size={14} /></span>
    <div className={styles.card}>
      <button type="button" className={styles.summary} aria-expanded={expanded} onClick={onToggle}>
        <span className={styles.number}>{String(step.index).padStart(2, '0')}</span>
        <span className={styles.identity}>
          <strong>{configured?.name || stepLabel(step.kind, t)}</strong>
          <span className={styles.meta}>
            <span><Icon size={12} />{stepLabel(step.kind, t)}</span>
            <span className={styles.state}>{t(`desktopWorkflow.states.${step.state}`, { defaultValue: step.state })}</span>
            <span>{runDuration(step.started_at, step.finished_at)}</span>
            {step.asset_id && <Image size={12} aria-label={t('desktopWorkflow.evidence')} />}
          </span>
        </span>
        <ChevronDown className={styles.chevron} size={14} />
      </button>
      {failed && step.error_code && <p className={styles.error}>{workflowError({ code: step.error_code }, t)}</p>}
      {expanded && <div className={styles.details}>
        {configured ? <StepActionDetails step={configured} parameters={parameters} gateway={gateway} onImage={onImage} /> : <p className={styles.hint}>{t('desktopWorkflow.actionDetailsUnavailable')}</p>}
        <dl className={styles.timing}><div><dt>{t('desktopWorkflow.stepOccurrence')}</dt><dd>{step.occurrence || '—'}</dd></div><div><dt>{t('desktopWorkflow.startedAt')}</dt><dd>{runTime(step.started_at)}</dd></div><div><dt>{t('desktopWorkflow.finishedAt')}</dt><dd>{runTime(step.finished_at)}</dd></div></dl>
        {step.asset_id && <div className={styles.evidence}><ExecutionImageCard assetID={step.asset_id} title={t('desktopWorkflow.evidence')} actionLabel={t('desktopWorkflow.viewEvidence')} gateway={gateway} onImage={onImage} /></div>}
        {step.evidence_cleared && <p className={styles.hint}>{t('desktopWorkflow.evidenceCleared')}</p>}
      </div>}
    </div>
  </li>
}

export function RunStepTimeline({ steps, definition, gateway, onImage, expansion, onExpansionChange }: Props) {
  const { t } = useTranslation()
  const [local, setLocal] = useState<Expansion>({ allExpanded: false, exceptions: [] })
  const { allExpanded, exceptions } = expansion ?? local
  const excluded = new Set(exceptions)
  const change = onExpansionChange ?? setLocal
  const configured = useMemo(() => {
    const map = new Map<string, Step>()
    const visit = (items: Step[]) => { for (const step of items) { map.set(step.id, step); visit(step.steps ?? []); visit(step.else ?? []) } }
    visit(definition?.steps ?? [])
    return map
  }, [definition])
  const expandAll = (expand: boolean) => change({ allExpanded: expand, exceptions: [] })
  const toggle = (key: string) => {
    const next = new Set(exceptions)
    if (next.has(key)) next.delete(key); else next.add(key)
    change({ allExpanded, exceptions: [...next] })
  }
  return <section className={styles.timeline}>
    <header className={styles.header}><h4><Clock3 size={15} />{t('desktopWorkflow.executionChain')}<span>{steps.length}</span></h4><div className={styles.actions}>
      <Button size="small" type="text" icon={<ChevronsUpDown size={13} />} disabled={!steps.length} onClick={() => expandAll(true)}>{t('desktopWorkflow.expandAll')}</Button>
      <Button size="small" type="text" icon={<ChevronsDownUp size={13} />} disabled={!steps.length} onClick={() => expandAll(false)}>{t('desktopWorkflow.collapseAll')}</Button>
    </div></header>
    {steps.length ? <ol className={styles.list}>{steps.map(step => {
      const key = `${step.run_id}:${step.index}`
      const expanded = excluded.has(key) ? !allExpanded : allExpanded
      const candidate = configured.get(step.step_id)
      return <Result key={key} step={step} configured={candidate?.kind === step.kind ? candidate : undefined} parameters={definition?.parameters ?? []} expanded={expanded} onToggle={() => toggle(key)} gateway={gateway} onImage={onImage} />
    })}</ol> : <p className={styles.hint}>{t('desktopWorkflow.noStepResults')}</p>}
  </section>
}
