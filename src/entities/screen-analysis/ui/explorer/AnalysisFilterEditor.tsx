import { Alert, Collapse, Input } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisQuery } from '#common/contracts'
import { CustomSelect, SettingsNumberInput } from '#shared/ui'
import { analysisMinimumFilter, parseAnalysisFilter } from '../../model/analysisFilterInput'
import styles from './AnalysisFilterEditor.module.scss'

export function AnalysisFilterEditor({ value, ocr, onChange }: {
  value: AnalysisQuery; ocr: boolean; onChange: (value: AnalysisQuery) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(() => analysisMinimumFilter(value))
  const [box, setBox] = useState(value.bbox?.join(', ') ?? '')
  const [ids, setIDs] = useState((ocr ? value.span_ids : value.element_ids)?.join(', ') ?? '')
  const [error, setError] = useState(false)
  const patch = (next: Partial<AnalysisQuery>, nextBox = box, nextIDs = ids) => {
    const updated = { ...draft, ...next, q: value.q }
    setDraft(updated); setBox(nextBox); setIDs(nextIDs)
    const parsed = parseAnalysisFilter(updated, nextBox, nextIDs, ocr)
    setError(!parsed)
    if (parsed) onChange(parsed)
  }
  return <div className={styles.form}>
    <div className={styles.fields}>
    <CustomSelect label={t('desktopWorkflow.analysis.filter')} value={draft.kind ?? 'all'} options={['all', 'region', 'text'].map(kind => ({ value: kind, label: t(`desktopWorkflow.analysis.${kind}`) }))}
      onChange={kind => patch({ kind: kind === 'all' ? undefined : kind as AnalysisQuery['kind'], sort: 'spatial' })} />
    {(['detection', 'text'] as const).map(prefix => <label key={prefix}>
      {t(`desktopWorkflow.analysisWorkspace.${prefix}Minimum`)}
      <SettingsNumberInput className={styles.number} min={0} max={100} step={5} unit="%" placeholder={t('desktopWorkflow.analysisWorkspace.unlimited')}
        aria-label={t(`desktopWorkflow.analysisWorkspace.${prefix}Minimum`)} value={draft[`${prefix}_min`] === undefined ? null : Number((draft[`${prefix}_min`]! * 100).toFixed(8))}
        onChange={n => patch({ [`${prefix}_min`]: n == null ? undefined : n / 100 })} />
    </label>)}
    <Collapse ghost defaultActiveKey={value.bbox || value.element_ids || value.span_ids || value.source || value.sort ? ['advanced'] : []} items={[{
      key: 'advanced', label: t('desktopWorkflow.analysisWorkspace.advancedFilters'), children: <div className={styles.fields}>
    <CustomSelect label={t('analysisCenter.source')} value={draft.source ?? 'all'} options={['all', 'detector', 'detector+ocr', 'ocr'].map(source => ({ value: source, label: t(`analysisCenter.sources.${source}`) }))}
      onChange={source => patch({ source: source === 'all' ? undefined : source as AnalysisQuery['source'] })} />
    <label>{t('desktopWorkflow.analysisWorkspace.ids')}<Input value={ids} onChange={e => patch({}, box, e.target.value)} placeholder="0, 1, 2" /></label>
    <label>{t('analysisCenter.bbox')}<Input value={box} onChange={e => patch({}, e.target.value)} placeholder="x1, y1, x2, y2" /></label>
    <CustomSelect label={t('analysisCenter.sort')} value={draft.sort ?? 'spatial'} options={['spatial', 'confidence_asc', 'confidence_desc'].map(sort => ({ value: sort, label: t(`analysisCenter.sorts.${sort}`), disabled: !ocr && !draft.kind && sort !== 'spatial' }))}
      onChange={sort => patch({ sort: sort as AnalysisQuery['sort'] })} />
    </div> }]} />
    {error && <Alert type="error" title={t('desktopWorkflow.analysisWorkspace.invalidFilter')} />}
    </div>
  </div>
}
