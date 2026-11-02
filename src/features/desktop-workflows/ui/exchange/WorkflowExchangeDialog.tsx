import { Alert, Button, Descriptions, Image, Input, Modal, Pagination, Progress, Select, Space, Tag } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkflowExchangeAsset } from '#entities/desktop-workflow'
import { workflowSummary } from '../../model/exchange/summary'
import type { WorkflowMediaGateway, WorkflowSurfaceModel } from '../../model/workspace/types'
import { workflowError } from '../../model/messages'
import styles from './WorkflowExchangeDialog.module.scss'

function TemplateImage({ id, asset, gateway }: { id: string; asset: WorkflowExchangeAsset; gateway: WorkflowMediaGateway }) {
  const [source, setSource] = useState<string>()
  const [failed, setFailed] = useState(false)
  const { t } = useTranslation()
  useEffect(() => {
    const abort = new AbortController(); let url: string | undefined
    void gateway.importAsset?.(id, asset.sha256, abort.signal).then(blob => {
      if (!abort.signal.aborted) { url = URL.createObjectURL(blob); setSource(url) }
    }).catch(() => { if (!abort.signal.aborted) setFailed(true) })
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url) }
  }, [gateway, id, asset.sha256])
  return <figure className={styles.template}><Image src={source} width={96} height={72} preview={!!source} alt={t('desktopWorkflow.exchange.template')} />
    <figcaption>{failed ? t('desktopWorkflow.exchange.imageFailed') : `${asset.path} · ${asset.width} × ${asset.height}`}</figcaption></figure>
}
export function WorkflowExchangeDialog({ model, gateway, guard }: { model: WorkflowSurfaceModel; gateway: WorkflowMediaGateway; guard: (next: () => void) => void }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const state = model.state.exchange
  const dispatch = model.actions.exchange
  if (!state || !dispatch) return null
  const { preview, busy, target, progress } = state
  const manifest = preview?.manifest
  const assets = preview?.assets ?? []
  const summary = manifest && workflowSummary(manifest.definition)
  const previous = target && workflowSummary(target.version.definition)
  const close = () => { void dispatch({ kind: busy ? 'cancel' : 'close' }) }
  const currentPage = Math.min(page, Math.max(1, Math.ceil(assets.length / 12)))
  return <Modal open={busy || !!preview || !!state.error || !!state.receipt || !!state.exported} width={700}
    title={t('desktopWorkflow.exchange.title')} onCancel={close} closable={!state.uncertain} mask={{ closable: false }}
    footer={<Space><Button disabled={state.uncertain && !busy} onClick={close}>{t(busy ? 'desktopWorkflow.exchange.cancel' : 'desktopWorkflow.exchange.close')}</Button>
      {manifest && <Button type="primary" loading={busy} disabled={busy || state.conflict || !state.name?.trim()}
        onClick={() => guard(() => { void dispatch({ kind: 'commit' }) })}>{t(state.uncertain ? 'desktopWorkflow.exchange.retryCommit' : target ? 'desktopWorkflow.exchange.update' : 'desktopWorkflow.exchange.create')}</Button>}</Space>}>
    <div className={styles.body}>
      {state.error && <Alert type="error" showIcon title={workflowError(state.error, t)} description={state.error.details && <>
        {state.error.details.field && <p>{state.error.details.field}</p>}
        {state.error.details.diagnostics?.map((item, index) => <p key={index}>{item.step_id ? `${item.step_id} · ` : ''}{item.field}: {t(`desktopWorkflow.diagnostics.${item.code}`, { defaultValue: item.code })}</p>)}
      </>} />}
      {state.uncertain && <Alert type="warning" showIcon title={t('desktopWorkflow.exchange.uncertain')} />}
      {busy && <div role="status"><span>{t(`desktopWorkflow.exchange.phases.${progress?.phase ?? 'validating'}`)}</span>
        <Progress percent={progress?.total_bytes ? Math.min(100, Math.round((progress.transferred_bytes ?? 0) * 100 / progress.total_bytes)) : undefined} status="active" showInfo={!!progress?.total_bytes} /></div>}
      {state.exported && <Alert type="success" title={t('desktopWorkflow.exchange.exported', { name: state.exported })} />}
      {state.receipt && <Alert type="success" title={t('desktopWorkflow.exchange.imported', { name: state.receipt.script.name, version: state.receipt.script.revision })}
        action={<Button onClick={() => guard(() => { void model.actions.load(state.receipt!.script.id); void dispatch({ kind: 'close' }) })}>{t('desktopWorkflow.exchange.open')}</Button>} />}
      {manifest && <>
        <label className={styles.field}><span>{t('desktopWorkflow.scriptName')}</span><Input value={state.name} maxLength={160} disabled={busy || state.uncertain} onChange={event => void dispatch({ kind: 'name', name: event.target.value })} /></label>
        <label className={styles.field}><span>{t('desktopWorkflow.exchange.destination')}</span><Select value={target?.script.id ?? ''} disabled={busy || state.uncertain}
          options={[{ value: '', label: t('desktopWorkflow.exchange.new') }, ...model.scripts.map(script => ({ value: script.id, label: `${script.name} · v${script.revision}` }))]}
          onChange={id => void dispatch({ kind: 'target', id: id || undefined })} /></label>
        {manifest.description && <p>{manifest.description}</p>}
        <div>{manifest.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</div>
        <Descriptions size="small" column={2} items={[
          { key: 'steps', label: t('desktopWorkflow.steps'), children: summary?.count },
          { key: 'assets', label: t('desktopWorkflow.exchange.templates'), children: assets.length },
          { key: 'parameters', label: t('desktopWorkflow.parameters'), children: manifest.definition.parameters.length },
          { key: 'disabled', label: t('desktopWorkflow.exchange.disabled'), children: summary?.disabled },
        ]} />
        {target && <Alert type="warning" showIcon title={t('desktopWorkflow.exchange.replace', { name: target.script.name, version: target.script.revision })}
          description={t('desktopWorkflow.exchange.changes', { before: previous?.count, after: summary?.count })} />}
        {state.conflict && <Alert type="warning" title={t('desktopWorkflow.exchange.conflict')}
          action={<Button onClick={() => void dispatch({ kind: 'target', id: target?.script.id })}>{t('desktopWorkflow.loadLatest')}</Button>} />}
        <Alert type="info" title={t(summary?.ocr ? 'desktopWorkflow.exchange.requiresOCR' : 'desktopWorkflow.exchange.requiresTarget')} />
        {!!preview.diagnostics?.length && <Alert type="warning" title={t('desktopWorkflow.exchange.incomplete')} description={<ul>{preview.diagnostics.map((item, index) =>
          <li key={index}>{item.step_id ? `${item.step_id} · ` : ''}{item.field}: {t(`desktopWorkflow.diagnostics.${item.code}`, { defaultValue: item.code })}</li>)}</ul>} />}
        {!!assets.length && <><div className={styles.templates}>{assets.slice((currentPage - 1) * 12, currentPage * 12).map(asset => <TemplateImage key={`${preview.id}:${asset.path}`} id={preview.id} asset={asset} gateway={gateway} />)}</div>
          {assets.length > 12 && <Pagination size="small" current={currentPage} pageSize={12} total={assets.length} showSizeChanger={false} onChange={setPage} />}</>}
      </>}
    </div>
  </Modal>
}
