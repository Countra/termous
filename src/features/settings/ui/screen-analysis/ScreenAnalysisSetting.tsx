import { Button } from 'antd'
import { RotateCcw, ScanSearch, Scan, TextSearch } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { analysisParameterBounds, isScreenAnalysisParameters, screenAnalysisDefaults, validAnalysisNumber, analysisParameterEnabled, type AnalysisNumberParameter } from '#common/contracts'
import { settingsErrorCode, useSettingsModule } from '#entities/settings'
import { SettingsDetails, SettingsField, SettingsGroup } from '../controls/SettingsGroup'
import { SettingsNumberInput } from '#shared/ui'
import styles from '../controls/SettingsGroup.module.scss'
import { ScreenAnalysisMode } from './ScreenAnalysisMode'
import layout from './ScreenAnalysisSettings.module.scss'

type Draft = { [K in AnalysisNumberParameter]: number | null } & { ocr_enabled: boolean; detector_enabled: boolean }
interface Edit { value: Draft; revision: number }

export function ScreenAnalysisSetting({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const id = useId()
  const module = useSettingsModule('screen_analysis', { refreshOnFocus: true })
  const [edit, setEdit] = useState<Edit>()
  const pending = useRef(false)
  const latestEdit = useRef<Edit | undefined>(undefined)
  const confirmed = isScreenAnalysisParameters(module.snapshot?.value) ? module.snapshot.value : undefined
  const value = edit?.value ?? confirmed
  const locked = disabled || module.busy || !confirmed || !module.available || module.snapshot?.state.status === 'unavailable'
  const conflict = settingsErrorCode(module.error) === 'SETTINGS_REVISION_CONFLICT'
  const setDraft = (next: Draft) => {
    const nextEdit = { value: next, revision: latestEdit.current?.revision ?? module.snapshot!.revision }
    latestEdit.current = nextEdit
    setEdit(nextEdit)
    return nextEdit
  }
  const save = async (next = latestEdit.current) => {
    if (locked || pending.current || !next || !isScreenAnalysisParameters(next.value)) return
    pending.current = true
    try {
      const result = await module.update({ ...next.value }, next.revision)
      if (result && latestEdit.current === next) { latestEdit.current = undefined; setEdit(undefined) }
    } finally { pending.current = false }
  }
  const number = (key: AnalysisNumberParameter) => {
    const bounds = analysisParameterBounds[key]
    const valid = !value || validAnalysisNumber(key, value[key])
    return <SettingsField key={key} label={t(`settings.screenAnalysis.${key}`)} htmlFor={`${id}-${key}`}
      description={t(`settings.screenAnalysis.${key}Hint`)} descriptionId={`${id}-${key}-hint`}
      control={<SettingsNumberInput id={`${id}-${key}`} aria-describedby={`${id}-${key}-hint`} aria-invalid={!valid}
        aria-valuemin={bounds.min} aria-valuemax={bounds.max} step={bounds.step} changeOnBlur={false}
        value={value?.[key]} disabled={locked || !!value && !analysisParameterEnabled(key, value)}
        status={valid ? undefined : 'error'} onChange={next => { if (value) setDraft({ ...value, [key]: next }) }}
        onBlur={() => void save()} onPressEnter={() => void save()} />}>
      {!valid && <p role="alert" className={styles.error}>{t('settings.screenAnalysis.invalid')}</p>}
    </SettingsField>
  }
  const reset = () => { void save(setDraft({ ...screenAnalysisDefaults })) }
  const reload = async () => {
    const snapshot = await module.refresh()
    if (snapshot) { latestEdit.current = undefined; setEdit(undefined) }
  }
  return <SettingsGroup title={t('settings.screenAnalysis.defaults')} icon={<ScanSearch size={16} aria-hidden="true" />}>
    <ScreenAnalysisMode value={value ?? screenAnalysisDefaults} disabled={locked}
      onChange={modes => { if (value) void save(setDraft({ ...value, ...modes })) }} />
    <div className={layout['parameter-grid']}>
      <section className={layout['parameter-section']} aria-labelledby={`${id}-detector`}>
        <div className={layout['parameter-heading']}><h4 id={`${id}-detector`}><Scan size={14} aria-hidden="true" />{t('settings.screenAnalysis.detectorSection')}</h4>
          {value && !value.detector_enabled && <span>{t('settings.screenAnalysis.inactive')}</span>}</div>
        {number('confidence')}{number('image_size')}
        <div className={layout.advanced}><SettingsDetails summary={t('settings.screenAnalysis.advanced')}>
          {number('nms_iou')}{number('max_detections')}
        </SettingsDetails></div>
      </section>
      <section className={layout['parameter-section']} aria-labelledby={`${id}-ocr`}>
        <div className={layout['parameter-heading']}><h4 id={`${id}-ocr`}><TextSearch size={14} aria-hidden="true" />{t('settings.screenAnalysis.ocrSection')}</h4>
          {value && !value.ocr_enabled && <span>{t('settings.screenAnalysis.inactive')}</span>}</div>
        {number('text_confidence')}{number('ocr_max_side')}
      </section>
    </div>
    <div className={layout.footer}>
    <p className={styles.hint}>{t('settings.screenAnalysis.defaultsHint')}</p>
    {!confirmed && !module.busy && <p role="status" className={styles.hint}>{t('settings.screenAnalysis.unavailable')}</p>}
    {module.error && <p role="alert" className={styles.error}>
      {t(conflict ? 'settings.conflict' : 'settings.screenAnalysis.saveFailed')}
      <Button type="link" size="small" disabled={disabled || module.busy} onClick={() => void (conflict || !edit ? reload() : save())}>
        {t(conflict ? 'settings.screenAnalysis.reload' : 'app.retry')}
      </Button>
    </p>}
    <Button size="small" icon={<RotateCcw size={13} aria-hidden="true" />} disabled={locked} onClick={reset}>{t('settings.screenAnalysis.reset')}</Button>
    </div>
  </SettingsGroup>
}
