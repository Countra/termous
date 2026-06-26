import { Button, InputNumber, Select, Segmented, Slider, Switch } from 'antd'
import { RotateCcw, SquareTerminal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TerminalSettings } from '../../types/domain'
import { defaultTerminalSettings, normalizeTerminalSettings } from './terminalSettings'

interface TerminalStyleSettingsProps {
  value: TerminalSettings
  disabled: boolean
  onChange: (value: TerminalSettings) => Promise<void>
}

type NumericKey = 'font_size' | 'line_height' | 'letter_spacing'

export function TerminalStyleSettings({ value, disabled, onChange }: TerminalStyleSettingsProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(() => normalizeTerminalSettings(value))
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    setDraft(normalizeTerminalSettings(value))
  }, [value])

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  const fontOptions = useMemo(
    () => [
      { value: 'jetbrains_mono', label: 'JetBrains Mono' },
      { value: 'consolas', label: 'Consolas' },
      { value: 'monospace', label: 'monospace' },
    ],
    [],
  )

  const commit = (next: TerminalSettings, delay = 0) => {
    setDraft(next)
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void onChange(next)
    }, delay)
  }

  const updateDraft = (patch: Partial<TerminalSettings>, delay = 0) => {
    commit(normalizeTerminalSettings({ ...draft, ...patch }), delay)
  }

  const updateNumber = (key: NumericKey, value: number | null, delay = 320) => {
    if (typeof value !== 'number') {
      return
    }
    updateDraft({ [key]: normalizeNumberValue(key, value) }, delay)
  }

  return (
    <div className="settings-section terminal-style-section">
      <div className="settings-section-header">
        <SquareTerminal size={18} aria-hidden="true" />
        <h2>{t('settings.terminalSection')}</h2>
      </div>

      <div className="terminal-style-grid">
        <div className="terminal-style-controls">
          <SettingLine label={t('settings.terminalFont')}>
            <Select
              value={draft.font_family}
              disabled={disabled}
              className="termous-select terminal-style-select"
              classNames={{ popup: { root: 'termous-select-popup' } }}
              options={fontOptions}
              onChange={(fontFamily) => updateDraft({ font_family: fontFamily as TerminalSettings['font_family'] })}
            />
          </SettingLine>

          <NumberSetting
            label={t('settings.terminalFontSize')}
            value={draft.font_size}
            min={12}
            max={22}
            step={1}
            precision={0}
            disabled={disabled}
            onChange={(next) => updateNumber('font_size', next)}
          />

          <NumberSetting
            label={t('settings.terminalLineHeight')}
            value={draft.line_height}
            min={1}
            max={1.6}
            step={0.05}
            precision={2}
            disabled={disabled}
            onChange={(next) => updateNumber('line_height', next)}
          />

          <NumberSetting
            label={t('settings.terminalLetterSpacing')}
            value={draft.letter_spacing}
            min={0}
            max={2}
            step={0.5}
            precision={1}
            disabled={disabled}
            onChange={(next) => updateNumber('letter_spacing', next)}
          />

          <SettingLine label={t('settings.terminalCursor')}>
            <Segmented
              block
              value={draft.cursor_style}
              disabled={disabled}
              className="settings-control-segmented"
              options={[
                { value: 'block', label: t('settings.cursorBlock') },
                { value: 'bar', label: t('settings.cursorBar') },
                { value: 'underline', label: t('settings.cursorUnderline') },
              ]}
              onChange={(cursorStyle) => updateDraft({ cursor_style: cursorStyle as TerminalSettings['cursor_style'] })}
            />
          </SettingLine>

          <SettingLine label={t('settings.terminalCursorBlink')}>
            <Switch
              checked={draft.cursor_blink}
              disabled={disabled}
              onChange={(cursorBlink) => updateDraft({ cursor_blink: cursorBlink })}
            />
          </SettingLine>

          <SettingLine label={t('settings.terminalTheme')}>
            <Segmented
              block
              value={draft.theme_mode}
              disabled={disabled}
              className="settings-control-segmented"
              options={[
                { value: 'follow_app', label: t('settings.themeFollowApp') },
                { value: 'dark', label: t('settings.themeDark') },
                { value: 'light', label: t('settings.themeLight') },
                { value: 'custom', label: t('settings.themeCustom') },
              ]}
              onChange={(themeMode) => updateDraft({ theme_mode: themeMode as TerminalSettings['theme_mode'] })}
            />
          </SettingLine>

          <SettingLine label={t('settings.terminalScrollback')}>
            <Segmented
              block
              value={draft.scrollback}
              disabled={disabled}
              className="settings-control-segmented scrollback-segmented"
              options={[1000, 5000, 10000, 50000].map((scrollback) => ({
                value: scrollback,
                label: String(scrollback),
              }))}
              onChange={(scrollback) => updateDraft({ scrollback: scrollback as TerminalSettings['scrollback'] })}
            />
          </SettingLine>

          <div className="settings-reset-row">
            <Button
              icon={<RotateCcw size={15} aria-hidden="true" />}
              disabled={disabled}
              onClick={() => commit(defaultTerminalSettings)}
            >
              {t('settings.resetTerminal')}
            </Button>
          </div>
        </div>

        <TerminalPreview settings={draft} />
      </div>
    </div>
  )
}

function SettingLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="terminal-setting-line">
      <span>{label}</span>
      <div>{children}</div>
    </label>
  )
}

function NumberSetting({
  label,
  value,
  min,
  max,
  step,
  precision,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  precision: number
  disabled: boolean
  onChange: (value: number | null) => void
}) {
  return (
    <SettingLine label={label}>
      <div className="terminal-number-control">
        <Slider min={min} max={max} step={step} value={value} disabled={disabled} onChange={onChange} />
        <InputNumber
          min={min}
          max={max}
          step={step}
          precision={precision}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      </div>
    </SettingLine>
  )
}

function normalizeNumberValue(key: NumericKey, value: number) {
  if (key === 'font_size') {
    return Math.round(value)
  }
  if (key === 'line_height') {
    return roundByStep(value, 0.05, 2)
  }
  return roundByStep(value, 0.5, 1)
}

function roundByStep(value: number, step: number, precision: number) {
  return Number((Math.round(value / step) * step).toFixed(precision))
}

function TerminalPreview({ settings }: { settings: TerminalSettings }) {
  const { t } = useTranslation()
  return (
    <div
      className={`terminal-style-preview theme-${settings.theme_mode}`}
      style={{
        fontFamily: previewFontFamily(settings.font_family),
        fontSize: settings.font_size,
        lineHeight: settings.line_height,
        letterSpacing: settings.letter_spacing,
      }}
      aria-label={t('settings.terminalPreview')}
    >
      <div className="terminal-preview-bar">
        <span>{t('settings.terminalPreview')}</span>
        <i className={`cursor-${settings.cursor_style} ${settings.cursor_blink ? 'is-blinking' : ''}`} />
      </div>
      <pre>
        <span className="terminal-preview-muted">$</span> ssh prod-web-01
        {'\n'}
        <span className="terminal-preview-green">ready</span> ~/workspace
        {'\n'}
        <span className="terminal-preview-blue">termous</span> status --latency=18ms
      </pre>
    </div>
  )
}

function previewFontFamily(fontFamily: TerminalSettings['font_family']) {
  if (fontFamily === 'consolas') {
    return 'Consolas, "JetBrains Mono", monospace'
  }
  if (fontFamily === 'monospace') {
    return 'monospace'
  }
  return '"JetBrains Mono", Consolas, monospace'
}
