import { LockKeyhole } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ImageTarget, Parameter, Step, Target } from '#entities/desktop-workflow'
import type { ImagePreviewSource } from '#shared/ui'
import type { WorkflowMediaGateway } from '../../model/workspace/types'
import { ExecutionImageCard } from './ExecutionImageCard'
import styles from './StepActionDetails.module.scss'

export function StepActionDetails({ step, parameters, gateway, onImage }: {
  step: Step; parameters: Parameter[]; gateway: Pick<WorkflowMediaGateway, 'asset'>; onImage: (source: ImagePreviewSource) => void
}) {
  const { t } = useTranslation()
  const bindings = step.bindings ?? {}
  const value = (field: string, fallback: unknown) => {
    const id = bindings[field]
    if (!id) return fallback == null ? '—' : String(fallback)
    const parameter = parameters.find(item => item.id === id)
    return t(parameter?.sensitive ? 'desktopWorkflow.sensitiveReference' : 'desktopWorkflow.parameterReference', { name: parameter?.name || id })
  }
  const field = (key: string, raw: unknown, label = key, format?: 'text' | 'keys') => {
    const codes = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : []
    return <div className={styles.field} key={key} data-wide={format === 'text' || undefined}>
      <dt>{t(`desktopWorkflow.${label}`)}</dt><dd>{bindings[key] ? <span className={styles.binding}><LockKeyhole size={12} />{value(key, raw)}</span> : format === 'text' ? <pre>{value(key, raw)}</pre> : format === 'keys' && codes.length ? <span className={styles.keys}>{codes.map((code, index) => <kbd key={`${index}:${code}`}>{code}</kbd>)}</span> : value(key, raw)}</dd>
    </div>
  }
  const target = (name: 'target' | 'endTarget', point?: Target) => point && <div className={styles.field} key={name}>
    <dt>{t(`desktopWorkflow.${name}`)}</dt><dd>{point.kind === 'point'
      ? `${name === 'target' ? value('x', point.x) : point.x ?? '—'}, ${name === 'target' ? value('y', point.y) : point.y ?? '—'}`
      : t('desktopWorkflow.imageTarget')}{point.reference_width && point.reference_height ? <small>{t('desktopWorkflow.referenceSize', { width: point.reference_width, height: point.reference_height })}</small> : null}</dd>
  </div>
  const action = step.action
  const template = (image: ImageTarget, targetName?: 'target' | 'endTarget') => {
    const title = targetName ? `${t('desktopWorkflow.template')} · ${t(`desktopWorkflow.${targetName}`)}` : t('desktopWorkflow.template')
    return <div className={styles.template}>
      <dt>{title}</dt><dd className={styles['template-content']}>
        <ExecutionImageCard assetID={image.asset_id} title={title} actionLabel={targetName ? `${t('desktopWorkflow.previewTemplate')} · ${t(`desktopWorkflow.${targetName}`)}` : t('desktopWorkflow.previewTemplate')} gateway={gateway} onImage={onImage} />
        <dl>
          {field('searchArea', image.region ? t('desktopWorkflow.regionSummary', { ...image.region }) : t('desktopWorkflow.fullScreen'))}
          {image.threshold != null && field('threshold', image.threshold)}
        </dl>
      </dd>
    </div>
  }
  return <section className={styles.details} aria-label={t('desktopWorkflow.configuredAction')}>
    <h5>{t('desktopWorkflow.configuredAction')}</h5>
    <dl>
      {step.kind.startsWith('pointer.') && target('target', step.target)}
      {step.kind === 'pointer.drag' && target('endTarget', step.end_target)}
      {(step.kind === 'pointer.click' || step.kind === 'pointer.drag') && field('button', action.button ? t(`desktopWorkflow.${action.button}`, { defaultValue: action.button }) : undefined)}
      {step.kind === 'pointer.click' && field('count', action.count)}
      {step.kind === 'pointer.scroll' && <>{field('delta', action.delta)}{field('horizontal', action.horizontal ? t('desktopWorkflow.horizontalDirection') : t('desktopWorkflow.verticalDirection'), 'scrollDirection')}</>}
      {step.kind === 'pointer.drag' && field('duration_ms', action.duration_ms)}
      {step.kind === 'keyboard.key' && field('code', action.code, 'key', 'keys')}
      {step.kind === 'keyboard.shortcut' && field('codes', action.codes, 'shortcut', 'keys')}
      {(step.kind === 'keyboard.text' || step.kind === 'clipboard.set_text') && field('text', action.text, 'text', 'text')}
      {step.kind === 'delay' && field('delay_ms', step.delay_ms, 'delay')}
      {step.kind === 'repeat' && field('iterations', step.iterations)}
      {step.kind === 'resize' && <>{field('width', action.width)}{field('height', action.height)}</>}
      {(step.kind.startsWith('image.') || step.kind === 'if') && field('condition', t(step.absent ? 'desktopWorkflow.absent' : 'desktopWorkflow.present'))}
      {(step.kind.startsWith('image.') || step.kind === 'if') && step.image && template(step.image)}
      {step.kind.startsWith('pointer.') && step.target?.kind === 'image' && step.target.image && template(step.target.image, step.kind === 'pointer.drag' ? 'target' : undefined)}
      {step.kind === 'pointer.drag' && step.end_target?.kind === 'image' && step.end_target.image && template(step.end_target.image, 'endTarget')}
      {step.timeout_ms != null && field('timeout_ms', step.timeout_ms, 'timeout')}
      {step.kind === 'capture' && field('action', t('desktopWorkflow.kinds.capture'), 'resultAction')}
      {step.kind === 'breakpoint' && field('action', t('desktopWorkflow.kinds.breakpoint'), 'resultAction')}
    </dl>
    {Object.keys(bindings).length > 0 && <p>{t('desktopWorkflow.boundValuesNotStored')}</p>}
  </section>
}
