import type { SelectProps } from 'antd'
import { useId } from 'react'
import { SelectControl } from './SelectControl'
import styles from './CustomSelect.module.scss'

export interface SelectOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

interface CustomSelectProps extends Pick<
  SelectProps<string>,
  'status' | 'aria-invalid' | 'aria-describedby'
> {
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
  status,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: CustomSelectProps) {
  const generatedId = useId()
  const controlId = id ?? `${generatedId}-control`
  const labelId = `${generatedId}-label`
  return (
    <div className={[styles['custom-select'], 'custom-select', className].filter(Boolean).join(' ')}>
      <label id={labelId} htmlFor={controlId} className={`${styles['field-label']} field-label`}>
        {label}
      </label>
      <SelectControl
        id={controlId}
        value={value}
        disabled={disabled}
        status={status}
        aria-labelledby={labelId}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        popupClassName={popupClassName}
        optionLabelProp="label"
        onChange={onChange}
        options={options.map((option) => ({
          value: option.value,
          label: option.label,
          title: option.description ?? option.label,
          disabled: option.disabled,
          item: option,
        }))}
        optionRender={(option) => {
          const item = option.data.item as SelectOption
          return (
            <span className={`${styles['option-content']} select-option-content`}>
              <span>{item.label}</span>
              {item.description ? <small>{item.description}</small> : null}
            </span>
          )
        }}
      />
    </div>
  )
}
