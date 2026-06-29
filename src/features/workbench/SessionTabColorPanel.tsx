import { Button, ColorPicker } from 'antd'
import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeSessionTabColor, sessionTabColorPresets } from './sessionTabPreferences'

interface SessionTabColorSelectOptions {
  keepOpen?: boolean
}

interface SessionTabColorPanelProps {
  color?: string
  onSelect: (color: string, options?: SessionTabColorSelectOptions) => void
  onReset: () => void
}

export function SessionTabColorPanel({ color, onSelect, onReset }: SessionTabColorPanelProps) {
  const { t } = useTranslation()
  const activeColor = useMemo(() => normalizeSessionTabColor(color) ?? sessionTabColorPresets[7], [color])
  const [customColor, setCustomColor] = useState(activeColor)

  useEffect(() => {
    setCustomColor(activeColor)
  }, [activeColor])

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
          value={customColor}
          format="hex"
          disabledAlpha
          onChange={(nextColor) => setCustomColor(nextColor.toHexString())}
          onChangeComplete={(nextColor) => {
            const nextHexColor = normalizeSessionTabColor(nextColor.toHexString())
            if (nextHexColor) {
              setCustomColor(nextHexColor)
              onSelect(nextHexColor, { keepOpen: true })
            }
          }}
        >
          <Button className="secondary-button" size="small">
            {t('terminal.tabMenu.customColor')}
          </Button>
        </ColorPicker>
      </div>
    </div>
  )
}
