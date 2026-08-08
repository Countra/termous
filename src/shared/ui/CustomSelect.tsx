import { Select } from 'antd'
import styles from './CustomSelect.module.scss'

export interface SelectOption {
  value: string
  label: string
  description?: string
}

interface CustomSelectProps {
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  id?: string
  className?: string
  popupClassName?: string
}

export function CustomSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  id,
  className,
  popupClassName,
}: CustomSelectProps) {
  return (
    <label className={[styles['custom-select'], 'custom-select', className].filter(Boolean).join(' ')}>
      <span className={`${styles['field-label']} field-label`}>{label}</span>
      <Select
        id={id}
        value={value}
        disabled={disabled}
        classNames={{
          popup: {
            root: ['termous-select-popup', popupClassName].filter(Boolean).join(' '),
          },
        }}
        className="termous-select"
        optionLabelProp="label"
        onChange={onChange}
        options={options.map((option) => ({
          value: option.value,
          label: option.label,
          title: option.description ?? option.label,
          disabled: false,
          item: option,
        }))}
        optionRender={(option) => {
          const item = option.data.item as SelectOption
          return (
            <span className="select-option-content">
              <span>{item.label}</span>
              {item.description ? <small>{item.description}</small> : null}
            </span>
          )
        }}
      />
    </label>
  )
}
