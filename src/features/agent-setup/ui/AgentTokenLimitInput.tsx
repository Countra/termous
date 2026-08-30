import { Button, Dropdown, InputNumber, Space, type InputNumberProps, type MenuProps } from 'antd'
import { ChevronDown } from 'lucide-react'
import { contextActionMenuPopupClassName } from '#shared/ui'
import styles from './AgentTokenLimitInput.module.scss'

interface AgentTokenLimitInputProps {
  value: number | null
  min: number
  max: number
  step: number
  presets: number[]
  presetMin?: number
  disabled: boolean
  status?: InputNumberProps<number>['status']
  errorId?: string
  label: string
  quickSelectLabel: string
  onChange: (value: number | null) => void
}

export function AgentTokenLimitInput({
  value,
  min,
  max,
  step,
  presets,
  presetMin = min,
  disabled,
  status,
  errorId,
  label,
  quickSelectLabel,
  onChange,
}: AgentTokenLimitInputProps) {
  const items: MenuProps['items'] = presets.map((preset) => ({
    key: String(preset),
    label: formatTokenPreset(preset),
    disabled: preset < presetMin || preset > max,
  }))
  const selectedKeys = value !== null && presets.includes(value) ? [String(value)] : []

  return (
    <Space.Compact
      block
      className={styles.control}
      data-disabled={disabled ? 'true' : undefined}
      data-status={status}
    >
      <InputNumber<number>
        value={value}
        step={step}
        precision={0}
        controls={false}
        disabled={disabled}
        status={status}
        variant="borderless"
        className={styles.number}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-invalid={status === 'error'}
        aria-describedby={status === 'error' ? errorId : undefined}
        onChange={onChange}
      />
      <Space.Addon
        variant="borderless"
        disabled={disabled}
        className={styles.unit}
      >
        Token
      </Space.Addon>
      <Dropdown
        trigger={['click']}
        disabled={disabled}
        classNames={{ root: contextActionMenuPopupClassName }}
        menu={{
          items,
          selectable: true,
          selectedKeys,
          onClick: ({ key }) => onChange(Number(key)),
        }}
      >
        <Button
          type="text"
          disabled={disabled}
          className={styles.trigger}
          icon={<ChevronDown size={13} aria-hidden="true" />}
          aria-label={quickSelectLabel}
        />
      </Dropdown>
    </Space.Compact>
  )
}

function formatTokenPreset(value: number) {
  return `${value / 1024}K`
}
