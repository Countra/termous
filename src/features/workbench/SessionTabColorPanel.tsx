import { Button, ColorPicker } from 'antd'
import { RotateCcw } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeSessionTabColor, sessionTabColorPresets } from './sessionTabPreferences'

interface SessionTabColorPanelProps {
  color?: string
  onSelect: (color: string) => void
  onReset: () => void
}

export function SessionTabColorPanel({ color, onSelect, onReset }: SessionTabColorPanelProps) {
  const { t } = useTranslation()
  const activeColor = normalizeSessionTabColor(color) ?? sessionTabColorPresets[7]

  return (
    <div className="session-tab-color-panel">
      <div className="session-tab-color-grid">
        {sessionTabColorPresets.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`session-tab-color-swatch ${preset === color ? 'is-active' : ''}`}
            style={{ '--session-tab-swatch': preset } as CSSProperties}
            aria-label={t('terminal.tabMenu.colorValue', { color: preset })}
            onClick={() => onSelect(preset)}
          />
        ))}
      </div>
      <div className="session-tab-color-actions">
        <Button className="secondary-button" size="small" icon={<RotateCcw size={13} />} onClick={onReset}>
          {t('terminal.tabMenu.resetColor')}
        </Button>
        <ColorPicker
          value={activeColor}
          format="hex"
          disabledAlpha
          onChangeComplete={(nextColor) => onSelect(nextColor.toHexString())}
        >
          <Button className="secondary-button" size="small">
            {t('terminal.tabMenu.customColor')}
          </Button>
        </ColorPicker>
      </div>
    </div>
  )
}
