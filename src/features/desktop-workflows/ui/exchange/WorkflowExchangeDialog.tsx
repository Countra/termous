import { Alert, Button, Input, Modal, Progress, Select, Tag } from 'antd'
import { ArrowRight, Check, FileCheck2, FileInput, FileOutput, FolderOpen, Info } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { workflowSummary } from '../../model/exchange/summary'
import type { WorkflowMediaGateway, WorkflowSurfaceModel } from '../../model/workspace/types'
import { workflowError } from '../../model/messages'
import { WorkflowExchangeSummary } from './WorkflowExchangeSummary'
import { WorkflowImportTemplates } from './WorkflowImportTemplates'
import styles from './WorkflowExchangeDialog.module.scss'
import shell from './WorkflowExchangeShell.module.scss'

export function WorkflowExchangeDialog({ model, gateway, guard }: { model: WorkflowSurfaceModel; gateway: WorkflowMediaGateway; guard: (next: () => void) => void }) {
  const { t } = useTranslation()
  const nameID = useId()
  const targetID = useId()
  const state = model.state.exchange
  const dispatch = model.actions.exchange
  if (!state || !dispatch) return null
  const { preview, busy, target, progress } = state
  const manifest = preview?.manifest
  const assets = preview?.assets ?? []
  const summary = manifest && workflowSummary(manifest.definition)
  const previous = target && workflowSummary(target.version.definition)
  const close = () => { void dispatch({ kind: busy ? 'cancel' : 'close' }) }
  const succeeded = !!state.receipt || !!state.exported
  const openImported = () => guard(() => { void model.actions.load(state.receipt!.script.id); void dispatch({ kind: 'close' }) })
  return <Modal centered open={busy || !!preview || !!state.error || succeeded} width={740} className={shell.dialog}
    title={<div className={shell.heading}><span className={shell['heading-icon']} data-success={succeeded || undefined}>{succeeded ? <Check size={21} /> : manifest ? <FileInput size={21} /> : <FileOutput size={21} />}</span>
      <div><h2>{t(state.exported ? 'desktopWorkflow.exchange.export' : manifest || state.receipt ? 'desktopWorkflow.exchange.import' : 'desktopWorkflow.exchange.title')}</h2>
        {manifest && <p>{t('desktopWorkflow.exchange.importIntro')}</p>}</div></div>}
    onCancel={close} closable={!state.uncertain} mask={{ closable: false }}
    footer={<div className={shell.footer}><div>
      <Button disabled={state.uncertain && !busy} onClick={close}>{t(busy ? 'desktopWorkflow.exchange.cancel' : 'desktopWorkflow.exchange.close')}</Button>
      {state.exported && state.exportedLocation && <Button type="primary" icon={<FolderOpen size={15} />} loading={state.openingDirectory} disabled={state.openingDirectory}
        onClick={() => void dispatch({ kind: 'open-directory', location_id: state.exportedLocation! })}>{t('desktopWorkflow.exchange.openDirectory')}</Button>}
      {state.receipt && <Button type="primary" icon={<ArrowRight size={15} />} iconPlacement="end" onClick={openImported}>{t('desktopWorkflow.exchange.open')}</Button>}
      {manifest && <Button type="primary" loading={busy} disabled={busy || state.conflict || !state.name?.trim()}
        onClick={() => guard(() => { void dispatch({ kind: 'commit' }) })}>{t(state.uncertain ? 'desktopWorkflow.exchange.retryCommit' : target ? 'desktopWorkflow.exchange.update' : 'desktopWorkflow.exchange.create')}</Button>}
    </div></div>}>
    <div className={shell.body} data-workflow-exchange="transfer">
      {state.error && <Alert type="error" showIcon title={workflowError(state.error, t)} description={state.error.details && <>
        {state.error.details.field && <p>{state.error.details.field}</p>}
        {state.error.details.diagnostics?.map((item, index) => <p key={index}>{item.step_id ? `${item.step_id} · ` : ''}{item.field}: {t(`desktopWorkflow.diagnostics.${item.code}`, { defaultValue: item.code })}</p>)}
      </>} />}
      {state.uncertain && <Alert type="warning" showIcon title={t('desktopWorkflow.exchange.uncertain')} />}
      {busy && <div className={styles.progress} role="status"><strong>{t(`desktopWorkflow.exchange.phases.${progress?.phase ?? 'validating'}`)}</strong>
        {progress?.total_bytes ? <Progress percent={Math.min(100, Math.round((progress.transferred_bytes ?? 0) * 100 / progress.total_bytes))} status="active" />
          : <div className={styles['progress-track']}><span /></div>}
        </div>}
      {succeeded && <div className={styles.result} role="status"><span className={styles['result-icon']}><FileCheck2 size={30} /></span>
        <h3>{state.receipt ? t('desktopWorkflow.exchange.imported', { name: state.receipt.script.name, version: state.receipt.script.revision }) : t('desktopWorkflow.exchange.exported', { name: state.exported })}</h3>
        <p>{t(state.receipt ? 'desktopWorkflow.exchange.importedHint' : 'desktopWorkflow.exchange.exportedHint')}</p></div>}
      {state.directoryError && <Alert type="error" showIcon title={workflowError(state.directoryError, t)} />}
      {manifest && <>
        <WorkflowExchangeSummary name={manifest.name} definition={manifest.definition} assetCount={assets.length} />
        {(manifest.description || !!manifest.tags.length) && <div className={styles.description}>{manifest.description && <p>{manifest.description}</p>}<div>{manifest.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</div></div>}
        <section className={styles.configuration} aria-label={t('desktopWorkflow.exchange.destination')}>
        <div className={styles.field}><label htmlFor={nameID}>{t('desktopWorkflow.scriptName')}</label><Input id={nameID} value={state.name} maxLength={160} disabled={busy || state.uncertain} onChange={event => void dispatch({ kind: 'name', name: event.target.value })} /></div>
        <div className={styles.field}><label htmlFor={targetID}>{t('desktopWorkflow.exchange.destination')}</label><Select id={targetID} value={target?.script.id ?? ''} disabled={busy || state.uncertain}
          options={[{ value: '', label: t('desktopWorkflow.exchange.new') }, ...model.scripts.map(script => ({ value: script.id, label: `${script.name} · v${script.revision}` }))]}
          onChange={id => void dispatch({ kind: 'target', id: id || undefined })} /></div>
        </section>
        {!!summary?.disabled && <div className={styles['disabled-note']}>{t('desktopWorkflow.exchange.disabledCount', { count: summary.disabled })}</div>}
        {target && <Alert type="warning" showIcon title={t('desktopWorkflow.exchange.replace', { name: target.script.name, version: target.script.revision })}
          description={t('desktopWorkflow.exchange.changes', { before: previous?.count, after: summary?.count })} />}
        {state.conflict && <Alert type="warning" title={t('desktopWorkflow.exchange.conflict')}
          action={<Button onClick={() => void dispatch({ kind: 'target', id: target?.script.id })}>{t('desktopWorkflow.loadLatest')}</Button>} />}
        {!!preview.diagnostics?.length && <Alert type="warning" title={t('desktopWorkflow.exchange.incomplete')} description={<ul>{preview.diagnostics.map((item, index) =>
          <li key={index}>{item.step_id ? `${item.step_id} · ` : ''}{item.field}: {t(`desktopWorkflow.diagnostics.${item.code}`, { defaultValue: item.code })}</li>)}</ul>} />}
        {!!assets.length && <WorkflowImportTemplates key={preview.id} id={preview.id} assets={assets} gateway={gateway} />}
        <div className={shell.notice}><Info size={16} /><p>{t(summary?.ocr ? 'desktopWorkflow.exchange.requiresOCR' : 'desktopWorkflow.exchange.requiresTarget')}</p></div>
      </>}
    </div>
  </Modal>
}
