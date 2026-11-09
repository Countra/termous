import { Alert, Button, Pagination, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OCRReportPage, StepResult } from '#entities/desktop-workflow'
import type { WorkflowMediaGateway } from '../../model/workspace/types'
import { workflowError } from '../../model/messages'
import { OCRSpans } from '../shared/OCRSpans'

export function OCRReportDetails({ step, gateway }: { step: StepResult; gateway: Pick<WorkflowMediaGateway,'ocrReport'> }) {
  const { t } = useTranslation()
  const [open,setOpen] = useState(false)
  const [page,setPage] = useState(1)
  const [loaded,setLoaded] = useState<{ key: string; value: OCRReportPage }>()
  const [error,setError] = useState<unknown>()
  const [retry,setRetry] = useState(0)
  const summary = step.ocr
  // 轮询对象会反复重建；只在报告内容或执行检查点变化时重新读取正文。
  const key = JSON.stringify([step.run_id, step.index, step.state, step.finished_at, summary, page])
  const value = loaded?.key === key ? loaded.value : undefined
  useEffect(() => {
    setLoaded(undefined); setError(undefined)
    if (!open || !summary?.available) return
    const controller = new AbortController()
    void gateway.ocrReport(step.run_id,step.index,(page-1)*20,20,controller.signal).then(v => {if (!controller.signal.aborted) setLoaded({key,value:v})},e => {if (!controller.signal.aborted) setError(e)})
    return () => controller.abort()
  },[gateway,step.run_id,step.index,summary?.available,open,page,retry,key])
  if (!summary) return null
  const actual = value?.summary ?? summary
  return <section aria-label={t('desktopWorkflow.ocr.details')}>
    <p>{t('desktopWorkflow.ocr.samples',{count:summary.samples})}</p>
    {summary.observations?.map((o,i) => <p key={i}>{t(`desktopWorkflow.ocr.roles.${o.role}`,{defaultValue:o.role})} · {t('desktopWorkflow.ocr.counts',{recognized:o.recognized_count,matched:o.matched_count})} · {o.duration_ms.toFixed(0)} ms · {o.device} · {t('desktopWorkflow.ocr.confidence')}: {o.parameters.text_confidence} · {o.parameters.ocr_max_side}px {o.selected_ids.length ? `· #${o.selected_ids.join(', #')}` : ''}</p>)}
    {summary.observations?.some(o => o.truncated) && <Alert type="warning" title={t('desktopWorkflow.ocr.incomplete')} />}
    {actual.report_truncated && <Alert type="warning" title={t('desktopWorkflow.ocr.reportTruncated')} />}
    {(actual.redacted || actual.cleared) && <p>{t(actual.redacted ? 'desktopWorkflow.ocr.redacted' : 'desktopWorkflow.evidenceCleared')}</p>}
    {actual.available && <Button size="small" onClick={() => setOpen(v => !v)}>{t(open ? 'desktopWorkflow.collapseAll' : 'desktopWorkflow.ocr.details')}</Button>}
    {open && actual.available && (error ? <Alert type="error" title={workflowError(error,t)} action={<Button onClick={() => setRetry(v => v+1)}>{t('app.retry')}</Button>} /> : !value ? <Spin /> : <>
      {Array.from(new Set(value.items.map(s => s.role))).map(role => <div key={role}><h5>{t(`desktopWorkflow.ocr.roles.${role}`,{defaultValue:role})}</h5><OCRSpans spans={value.items.filter(s => s.role === role)} /></div>)}
      <Pagination size="small" current={page} pageSize={20} total={value.total} showSizeChanger={false} onChange={setPage} />
    </>)}
  </section>
}
