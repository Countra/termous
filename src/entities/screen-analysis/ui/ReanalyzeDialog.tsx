import { Alert, InputNumber, Modal, Switch } from 'antd'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { analysisParameterBounds, isScreenAnalysisParameters, type AnalysisNumberParameter, type AnalysisGateway, type AnalysisRecord } from '#common/contracts'
import styles from './History.module.scss'

export function ReanalyzeDialog({ record, gateway, onDone, onClose }: { record: AnalysisRecord; gateway: AnalysisGateway; onDone: (id: string) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [value, setValue] = useState<{ [K in AnalysisNumberParameter]: number | null } & { ocr_enabled: boolean }>({ ...record.parameters })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const pending = useRef<{ content: string; id: string } | undefined>(undefined)
  const save = async () => {
    if (busy || !isScreenAnalysisParameters(value)) return
    const content = JSON.stringify(value)
    const request = pending.current?.content === content ? pending.current : { content, id: crypto.randomUUID() }; pending.current = request
    setBusy(true); setError(false)
    try {
      const task = await gateway.submitAnalysis({ request_id: request.id, source: { kind: 'analysis', id: record.id }, parameters: value, reuse: false })
      onDone(task.id)
    } catch { setError(true) }
    finally { setBusy(false) }
  }
  return <Modal open title={t('analysisCenter.reanalyze')} confirmLoading={busy} okButtonProps={{ disabled: !isScreenAnalysisParameters(value) }}
    onOk={() => void save()} onCancel={busy ? undefined : onClose} closable={!busy} cancelButtonProps={{ disabled: busy }}>
    <p>{t('analysisCenter.reanalyzeHint')}</p>
    {error && <Alert type="error" title={t('analysisCenter.submitFailed')} />}
    <div className={styles.parameters}>
      {(Object.keys(analysisParameterBounds) as AnalysisNumberParameter[]).map(key => <label key={key}>{t(`settings.screenAnalysis.${key}`)}
        <InputNumber aria-label={t(`settings.screenAnalysis.${key}`)} value={value[key]} {...analysisParameterBounds[key]}
          disabled={busy || !value.ocr_enabled && ['text_confidence', 'ocr_max_side'].includes(key)} onChange={next => setValue({ ...value, [key]: next })} /></label>)}
      <label>{t('settings.screenAnalysis.ocr_enabled')}<Switch checked={value.ocr_enabled} disabled={busy} onChange={next => setValue({ ...value, ocr_enabled: next })} /></label>
    </div>
  </Modal>
}
