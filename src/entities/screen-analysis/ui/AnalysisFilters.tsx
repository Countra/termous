import { Input, InputNumber, Select } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisQuery } from '#common/contracts'
import styles from './Analysis.module.scss'

export function AnalysisFilters({ value, spans, onChange }: { value: AnalysisQuery; spans: boolean; onChange: (value: AnalysisQuery) => void }) {
  const { t } = useTranslation()
  const [boxError, setBoxError] = useState(false)
  const [boxInput, setBoxInput] = useState(value.bbox?.join(',') ?? '')
  const set = (patch: Partial<AnalysisQuery>) => onChange({ ...value, ...patch, cursor: undefined })
  const score = (key: 'detection_min' | 'detection_max' | 'text_min' | 'text_max') => {
    const strict = key.replace('_min', '_gt').replace('_max', '_lt') as 'detection_gt' | 'detection_lt' | 'text_gt' | 'text_lt'
    const lower = key.endsWith('_min')
    const exclusive = value[strict] !== undefined
    return <label key={key}>{t(`analysisCenter.${key}`)}
      <Select size="small" aria-label={`${t(`analysisCenter.${key}`)} ${t('analysisCenter.image.boundary')}`} value={exclusive ? 'strict' : 'inclusive'}
        options={[{ value: 'inclusive', label: lower ? '≥' : '≤' }, { value: 'strict', label: lower ? '>' : '<' }]}
        onChange={mode => { const current = value[strict] ?? value[key] ?? (lower ? 0 : 1); set({ [key]: mode === 'inclusive' ? current : undefined, [strict]: mode === 'strict' ? current : undefined }) }} />
      <InputNumber aria-label={t(`analysisCenter.${key}`)} min={0} max={1} step={.05} size="small"
        value={value[strict] ?? value[key]} onChange={next => set({ [exclusive ? strict : key]: next ?? undefined })} />
    </label>
  }
  return <div className={styles.filters}>
    <Input.Search size="small" allowClear aria-label={t('desktopWorkflow.analysis.search')} placeholder={t('desktopWorkflow.analysis.search')}
      onSearch={q => set({ q: q || undefined })} />
    <Select size="small" aria-label={t('desktopWorkflow.analysis.filter')} value={value.kind ?? 'all'}
      options={['all', 'region', 'text'].map(kind => ({ value: kind, label: t(`desktopWorkflow.analysis.${kind}`) }))}
      onChange={kind => set({ kind: kind === 'all' ? undefined : kind as AnalysisQuery['kind'], sort: 'spatial' })} />
    <Select size="small" aria-label={t('analysisCenter.source')} value={value.source ?? 'all'}
      options={['all', 'detector', 'detector+ocr', 'ocr'].map(source => ({ value: source, label: t(`analysisCenter.sources.${source}`) }))}
      onChange={source => set({ source: source === 'all' ? undefined : source as AnalysisQuery['source'] })} />
    {score('detection_min')}{score('detection_max')}
    {score('text_min')}{score('text_max')}
    <Select size="small" aria-label={t('analysisCenter.sort')} value={value.sort ?? 'spatial'}
      options={['spatial', 'confidence_asc', 'confidence_desc'].map(sort => ({ value: sort, label: t(`analysisCenter.sorts.${sort}`), disabled: !spans && !value.kind && sort !== 'spatial' }))}
      onChange={sort => set({ sort })} />
    <Input size="small" aria-label={t('analysisCenter.bbox')} placeholder={t('analysisCenter.bboxHint')} status={boxError ? 'error' : undefined} aria-invalid={boxError}
      value={boxInput} onChange={event => setBoxInput(event.target.value)}
      onPressEnter={() => { const raw = boxInput.trim(); const box = raw.split(',').map(Number)
        const valid = !raw || box.length === 4 && raw.split(',').every(part => part.trim() !== '') && box.every(Number.isSafeInteger) && box[0] >= 0 && box[1] >= 0 && box[2] > box[0] && box[3] > box[1]
        setBoxError(!valid)
        if (!raw) set({ bbox: undefined })
        else if (valid) set({ bbox: box as [number, number, number, number] })
      }} />
    {boxError && <small role="alert">{t('analysisCenter.bboxInvalid')}</small>}
  </div>
}
