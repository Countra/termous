import { Select, type SelectProps } from 'antd'
import styles from './CustomSelect.module.scss'

export type SelectControlProps<ValueType = string> = Omit<SelectProps<ValueType>, 'classNames'> & {
  popupClassName?: string
}

// 基础选择器统一输入框与浮层样式；标签和布局由表单容器负责。
export function SelectControl<ValueType = string>({ className, popupClassName, ...props }: SelectControlProps<ValueType>) {
  return <Select<ValueType> {...props}
    className={[styles.select, 'termous-select', className].filter(Boolean).join(' ')}
    classNames={{ popup: { root: [styles['select-popup'], 'termous-select-popup', popupClassName].filter(Boolean).join(' ') } }}
  />
}
