import { ConfigProvider, InputNumber, type InputNumberProps, type ThemeConfig } from 'antd'
import type { ReactNode } from 'react'
import styles from './SettingsNumberInput.module.scss'

type SettingsNumberInputProps = Omit<InputNumberProps<number>, 'mode' | 'suffix' | 'addonBefore' | 'addonAfter' | 'stringMode' | 'variant'> & {
  unit?: ReactNode
}

const numberInputTheme: ThemeConfig = {
  components: { InputNumber: { handleVisible: true, handleWidth: 28, handleFontSize: 10 } },
}

// 统一数值、单位与步进按钮的展示；校验、草稿和保存时机仍由业务层负责。
export function SettingsNumberInput({ unit, className, ...props }: SettingsNumberInputProps) {
  return <ConfigProvider theme={numberInputTheme}>
    <div className={[styles.control, className].filter(Boolean).join(' ')} data-disabled={props.disabled || undefined}
      data-status={props.status} data-controls={props.controls !== false} data-unit={unit != null}>
      <InputNumber<number> {...props} mode="input" variant="borderless" className={styles.number}
        suffix={unit == null ? undefined : <span className={styles.unit}>{unit}</span>} />
    </div>
  </ConfigProvider>
}
