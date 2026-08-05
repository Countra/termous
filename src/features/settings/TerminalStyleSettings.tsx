import { Button, Collapse, InputNumber, Select, Segmented, Slider, Switch, Tooltip, Upload } from 'antd'
import { FileText, RotateCcw, SquareTerminal, Trash2, UploadCloud } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TerminalFont, TerminalSettings } from '../../types/domain'
import {
  defaultTerminalSettings,
  fontFamilyFromSetting,
  loadTerminalFont,
  normalizeTerminalSettings,
} from '#features/terminal'

interface TerminalStyleSettingsProps {
  value: TerminalSettings
  fonts: TerminalFont[]
  disabled: boolean
  onChange: (value: TerminalSettings) => Promise<void>
  onUploadFont: (file: File) => Promise<TerminalFont>
  onDeleteFont: (id: string) => Promise<void>
}

type NumericKey = 'font_size' | 'line_height' | 'letter_spacing'

export function TerminalStyleSettings({ value, fonts, disabled, onChange, onUploadFont, onDeleteFont }: TerminalStyleSettingsProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(() => normalizeTerminalSettings(value))
  const [fontBusyId, setFontBusyId] = useState<string | null>(null)
  const [uploadingFont, setUploadingFont] = useState(false)
  const [fontManagerOpen, setFontManagerOpen] = useState(false)
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
    () => groupedFontOptions(fonts, t),
    [fonts, t],
  )
  const importedFonts = useMemo(() => fonts.filter((font) => font.kind === 'imported'), [fonts])

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

  const uploadFont = async (file: File) => {
    setFontManagerOpen(true)
    setUploadingFont(true)
    try {
      await onUploadFont(file)
    } finally {
      setUploadingFont(false)
    }
  }

  const deleteFont = async (font: TerminalFont) => {
    setFontBusyId(font.id)
    try {
      await onDeleteFont(font.id)
    } finally {
      setFontBusyId(null)
    }
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

          <Collapse
            ghost
            activeKey={fontManagerOpen ? ['fonts'] : []}
            className="terminal-font-collapse"
            onChange={(key) => setFontManagerOpen(Array.isArray(key) ? key.includes('fonts') : key === 'fonts')}
            items={[
              {
                key: 'fonts',
                label: (
                  <span className="terminal-font-collapse-label">
                    <strong>{t('settings.importedFonts')}</strong>
                    <small>{t('settings.importedFontCount', { count: importedFonts.length })}</small>
                  </span>
                ),
                children: (
                  <div className="terminal-font-manager">
                    <div className="terminal-font-manager-topline">
                      <div>
                        <strong>{t('settings.importedFonts')}</strong>
                        <small>{t('settings.importFontHint')}</small>
                      </div>
                      <Upload
                        accept=".ttf,font/ttf"
                        showUploadList={false}
                        disabled={disabled || uploadingFont}
                        beforeUpload={(file) => {
                          void uploadFont(file)
                          return Upload.LIST_IGNORE
                        }}
                      >
                        <Button
                          icon={<UploadCloud size={15} aria-hidden="true" />}
                          loading={uploadingFont}
                          disabled={disabled || uploadingFont}
                        >
                          {t('settings.importFont')}
                        </Button>
                      </Upload>
                    </div>
                    {importedFonts.length === 0 ? (
                      <div className="terminal-font-empty">{t('settings.noImportedFonts')}</div>
                    ) : (
                      <div className="terminal-font-list">
                        {importedFonts.map((font) => {
                          const inUse = draft.font_family === font.id
                          return (
                            <div className="terminal-font-row" key={font.id}>
                              <span className="terminal-font-icon">
                                <FileText size={15} aria-hidden="true" />
                              </span>
                              <span className="terminal-font-copy">
                                <strong>{font.display_name}</strong>
                                <small>{fontMetaText(font)}</small>
                              </span>
                              <Tooltip title={inUse ? t('settings.currentFontInUse') : t('settings.deleteFont')}>
                                <Button
                                  icon={<Trash2 size={14} aria-hidden="true" />}
                                  disabled={disabled || inUse || fontBusyId === font.id}
                                  loading={fontBusyId === font.id}
                                  onClick={() => void deleteFont(font)}
                                />
                              </Tooltip>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ),
              },
            ]}
          />

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

        <TerminalPreview settings={draft} fonts={fonts} />
      </div>
    </div>
  )
}

function groupedFontOptions(fonts: TerminalFont[], t: (key: string) => string) {
  const builtin = fonts.filter((font) => font.kind === 'builtin')
  const imported = fonts.filter((font) => font.kind === 'imported')
  const fallbackBuiltin: TerminalFont[] = [
    { id: 'jetbrains_mono', kind: 'builtin', display_name: 'JetBrains Mono', family_name: 'JetBrains Mono' },
    { id: 'consolas', kind: 'builtin', display_name: 'Consolas', family_name: 'Consolas' },
    { id: 'monospace', kind: 'builtin', display_name: 'monospace', family_name: 'monospace' },
  ]
  return [
    {
      label: t('settings.builtinFonts'),
      options: (builtin.length ? builtin : fallbackBuiltin).map((font) => ({
        value: font.id,
        label: font.display_name,
      })),
    },
    {
      label: t('settings.importedFonts'),
      options: imported.map((font) => ({
        value: font.id,
        label: font.display_name,
      })),
    },
  ].filter((group) => group.options.length > 0)
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

function TerminalPreview({ settings, fonts }: { settings: TerminalSettings; fonts: TerminalFont[] }) {
  const { t } = useTranslation()
  const [fontReadyTick, setFontReadyTick] = useState(0)
  const previewFontFamily = fontFamilyFromSetting(settings.font_family, fonts)

  useEffect(() => {
    let active = true
    void loadTerminalFont(settings.font_family, fonts).then(() => {
      if (active) {
        setFontReadyTick((current) => current + 1)
      }
    })
    return () => {
      active = false
    }
  }, [fonts, settings.font_family])

  return (
    <div
      className={`terminal-style-preview theme-${settings.theme_mode}`}
      data-font-ready={fontReadyTick}
      style={{
        fontFamily: previewFontFamily,
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
      <pre style={{ fontFamily: previewFontFamily }}>
        <span className="terminal-preview-muted">$</span> ssh prod-web-01
        {'\n'}
        <span className="terminal-preview-green">ready</span> ~/workspace
        {'\n'}
        <span className="terminal-preview-blue">termous</span> status --latency=18ms
      </pre>
    </div>
  )
}

function fontMetaText(font: TerminalFont) {
  const parts = []
  if (typeof font.size_bytes === 'number' && font.size_bytes > 0) {
    parts.push(formatBytes(font.size_bytes))
  }
  if (font.created_at) {
    parts.push(new Date(font.created_at).toLocaleDateString())
  }
  return parts.join(' · ')
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }
  return `${bytes} B`
}
