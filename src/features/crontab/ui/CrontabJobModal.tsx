import { Alert, Button, Input, InputNumber, Modal, Segmented, Select, Switch } from 'antd'
import { Plus, RefreshCw, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CrontabJob } from '#entities/crontab'
import {
  EditorModeContext,
  customSelectStyles,
  type EditorMode,
} from '#shared/ui'
import {
  buildCrontabExpression,
  createCrontabScheduleDraft,
  hasPlausibleCrontabExpression,
  type CrontabScheduleDraft,
  type CrontabSchedulePreset,
} from '../model/schedulePresets'
import styles from './CrontabPanel.module.scss'

export interface CrontabJobSubmitValue {
  schedule: string
  command: string
  enabled: boolean
}

interface CrontabJobModalProps {
  open: boolean
  job: CrontabJob | null
  writable: boolean
  busy: boolean
  blocked: boolean
  blockMessage: string
  reloading: boolean
  onCancel: () => void
  onReload?: () => void
  onSubmit: (value: CrontabJobSubmitValue) => void
}

const presetValues: CrontabSchedulePreset[] = [
  'every_minute',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'reboot',
]

export function CrontabJobModal({
  open,
  job,
  writable,
  busy,
  blocked,
  blockMessage,
  reloading,
  onCancel,
  onReload,
  onSubmit,
}: CrontabJobModalProps) {
  const { t } = useTranslation()
  const mode: EditorMode = job ? 'edit' : 'create'
  const [schedule, setSchedule] = useState<CrontabScheduleDraft>(() => (
    createCrontabScheduleDraft(job?.expression)
  ))
  const [command, setCommand] = useState(job?.command ?? '')
  const [enabled, setEnabled] = useState(job?.enabled ?? true)

  useEffect(() => {
    if (!open) {
      return
    }
    setSchedule(createCrontabScheduleDraft(job?.expression))
    setCommand(job?.command ?? '')
    setEnabled(job?.enabled ?? true)
  }, [job, open])

  const expression = buildCrontabExpression(schedule)
  const invalidSchedule = !hasPlausibleCrontabExpression(expression)
  const invalidCommand = !command.trim() || /[\0\r\n]/u.test(command)
  const error = invalidSchedule
    ? t('workbench.crontab.editor.scheduleInvalid')
    : invalidCommand
      ? t('workbench.crontab.editor.commandInvalid')
      : ''
  const presetOptions = useMemo(() => (
    presetValues.map((value) => ({
      value,
      label: t(`workbench.crontab.editor.presets.${value}`),
    }))
  ), [t])
  const weekdayOptions = useMemo(() => (
    Array.from({ length: 7 }, (_, value) => ({
      value,
      label: t(`workbench.crontab.editor.weekdays.${value}`),
    }))
  ), [t])

  const updateSchedule = (patch: Partial<CrontabScheduleDraft>) => {
    setSchedule((current) => ({ ...current, ...patch }))
  }

  const submit = () => {
    if (error || !writable) {
      return
    }
    onSubmit({
      schedule: expression,
      command,
      enabled,
    })
  }

  return (
    <Modal
      open={open}
      centered
      destroyOnHidden
      width={560}
      className={`termous-modal ${styles['crontab-job-modal']}`}
      rootClassName={styles['crontab-job-modal-root']}
      title={(
        <EditorModeContext
          mode={mode}
          label={t(mode === 'edit' ? 'app.edit' : 'app.add')}
          title={t('workbench.crontab.editor.title')}
        />
      )}
      okText={(
        <span className={styles['crontab-editor-action-label']}>
          {mode === 'create'
            ? <Plus size={14} aria-hidden="true" />
            : <Save size={14} aria-hidden="true" />}
          <span>{t(mode === 'create' ? 'app.create' : 'app.save')}</span>
        </span>
      )}
      cancelText={t('app.cancel')}
      confirmLoading={busy}
      okButtonProps={{ disabled: Boolean(error) || !writable || busy || blocked || reloading }}
      cancelButtonProps={{ disabled: busy || reloading }}
      closable={!busy && !reloading}
      keyboard={!busy && !reloading}
      mask={{ closable: !busy && !reloading }}
      onCancel={() => {
        if (!busy && !reloading) {
          onCancel()
        }
      }}
      onOk={submit}
    >
      <div className={styles['crontab-job-form']}>
        {blocked ? (
          <Alert
            type="warning"
            showIcon
            title={blockMessage}
            action={onReload ? (
              <Button
                size="small"
                icon={<RefreshCw size={13} aria-hidden="true" />}
                loading={reloading}
                onClick={onReload}
              >
                {t('workbench.crontab.editor.reload')}
              </Button>
            ) : undefined}
          />
        ) : null}
        {!writable ? (
          <Alert
            type="warning"
            showIcon
            title={t('workbench.crontab.readOnly')}
            description={t('workbench.crontab.readOnlyHint')}
          />
        ) : null}
        <label className={styles['crontab-field']}>
          <span>{t('workbench.crontab.editor.scheduleMode')}</span>
          <Segmented
            block
            disabled={!writable}
            value={schedule.mode}
            options={[
              { value: 'common', label: t('workbench.crontab.editor.commonMode') },
              { value: 'custom', label: t('workbench.crontab.editor.customMode') },
            ]}
            onChange={(value) => updateSchedule({ mode: value as CrontabScheduleDraft['mode'] })}
          />
        </label>

        {schedule.mode === 'common' ? (
          <>
            <label className={styles['crontab-field']}>
              <span>{t('workbench.crontab.editor.preset')}</span>
              <Select
                id="crontab-preset"
                className={customSelectStyles.select}
                classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
                value={schedule.preset}
                disabled={!writable}
                options={presetOptions}
                onChange={(value) => updateSchedule({ preset: value })}
              />
            </label>
            <CommonScheduleFields
              schedule={schedule}
              disabled={!writable}
              weekdayOptions={weekdayOptions}
              onChange={updateSchedule}
            />
          </>
        ) : (
          <label className={styles['crontab-field']}>
            <span>{t('workbench.crontab.editor.expression')}</span>
            <Input
              id="crontab-expression"
              name="crontab-expression"
              value={schedule.customExpression}
              disabled={!writable}
              placeholder="*/15 * * * *"
              spellCheck={false}
              onChange={(event) => updateSchedule({ customExpression: event.target.value })}
            />
            <small>{t('workbench.crontab.editor.expressionHint')}</small>
          </label>
        )}

        <div className={styles['crontab-expression-preview']}>
          <span>{t('workbench.crontab.editor.preview')}</span>
          <code>{expression || t('fields.none')}</code>
        </div>

        <label className={styles['crontab-field']}>
          <span>{t('workbench.crontab.editor.command')}</span>
          <Input.TextArea
            id="crontab-command"
            name="crontab-command"
            value={command}
            disabled={!writable}
            rows={4}
            spellCheck={false}
            placeholder="/usr/local/bin/backup"
            onChange={(event) => setCommand(event.target.value)}
          />
          <small>{t('workbench.crontab.editor.commandHint')}</small>
        </label>

        <div className={styles['crontab-switch-line']}>
          <div>
            <strong>{t('workbench.crontab.editor.enabled')}</strong>
            <small>{t('workbench.crontab.editor.enabledHint')}</small>
          </div>
          <Switch
            checked={enabled}
            disabled={!writable}
            aria-label={t('workbench.crontab.editor.enabled')}
            onChange={setEnabled}
          />
        </div>

        {error ? <p className={styles['crontab-form-error']}>{error}</p> : null}
      </div>
    </Modal>
  )
}

function CommonScheduleFields({
  schedule,
  disabled,
  weekdayOptions,
  onChange,
}: {
  schedule: CrontabScheduleDraft
  disabled: boolean
  weekdayOptions: Array<{ value: number; label: string }>
  onChange: (patch: Partial<CrontabScheduleDraft>) => void
}) {
  const { t } = useTranslation()
  if (schedule.preset === 'every_minute' || schedule.preset === 'reboot') {
    return null
  }
  return (
    <div className={styles['crontab-time-grid']}>
      {schedule.preset === 'monthly' ? (
        <label className={styles['crontab-field']}>
          <span>{t('workbench.crontab.editor.monthDay')}</span>
          <InputNumber
            id="crontab-month-day"
            min={1}
            max={31}
            disabled={disabled}
            value={schedule.monthDay}
            onChange={(value) => onChange({ monthDay: Number(value ?? 1) })}
          />
        </label>
      ) : null}
      {schedule.preset === 'weekly' ? (
        <label className={styles['crontab-field']}>
          <span>{t('workbench.crontab.editor.weekday')}</span>
          <Select
            id="crontab-weekday"
            className={customSelectStyles.select}
            classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
            value={schedule.weekday}
            disabled={disabled}
            options={weekdayOptions}
            onChange={(value) => onChange({ weekday: value })}
          />
        </label>
      ) : null}
      {schedule.preset !== 'hourly' ? (
        <label className={styles['crontab-field']}>
          <span>{t('workbench.crontab.editor.hour')}</span>
          <InputNumber
            id="crontab-hour"
            min={0}
            max={23}
            disabled={disabled}
            value={schedule.hour}
            onChange={(value) => onChange({ hour: Number(value ?? 0) })}
          />
        </label>
      ) : null}
      <label className={styles['crontab-field']}>
        <span>{t('workbench.crontab.editor.minute')}</span>
        <InputNumber
          id="crontab-minute"
          min={0}
          max={59}
          disabled={disabled}
          value={schedule.minute}
          onChange={(value) => onChange({ minute: Number(value ?? 0) })}
        />
      </label>
    </div>
  )
}
