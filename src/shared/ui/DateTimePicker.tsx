import { DatePicker as AntdDatePicker } from 'antd'
import type {
  DatePickerProps as AntdDatePickerProps,
  TimePickerProps as AntdTimePickerProps,
} from 'antd'
import dayjs from 'dayjs'
import { CalendarClock, X } from 'lucide-react'
import styles from './DateTimePicker.module.scss'

export interface DateTimePickerProps {
  value: Date | null
  onChange: (value: Date | null) => void
  ariaLabel: string
  autoFocus?: boolean
  className?: string
  disabled?: boolean
  id?: string
  minuteStep?: AntdTimePickerProps['minuteStep']
  onOpenChange?: (open: boolean) => void
  placeholder?: string
  placement?: AntdDatePickerProps['placement']
  popupZIndex?: number
  size?: AntdDatePickerProps['size']
  status?: AntdDatePickerProps['status']
}

export function DateTimePicker({
  value,
  onChange,
  ariaLabel,
  autoFocus = false,
  className,
  disabled = false,
  id,
  minuteStep = 1,
  onOpenChange,
  placeholder,
  placement = 'bottomRight',
  popupZIndex,
  size,
  status,
}: DateTimePickerProps) {
  const pickerValue = value && Number.isFinite(value.getTime()) ? dayjs(value) : null

  return (
    <AntdDatePicker
      id={id}
      value={pickerValue}
      autoFocus={autoFocus}
      disabled={disabled}
      status={status}
      size={size}
      placement={placement}
      format="YYYY-MM-DD HH:mm"
      showTime={{ format: 'HH:mm', minuteStep }}
      needConfirm
      showNow
      allowClear={{
        clearIcon: <X size={11} strokeWidth={2} aria-hidden="true" />,
      }}
      suffixIcon={<CalendarClock size={14} strokeWidth={1.8} aria-hidden="true" />}
      className={[styles.picker, className].filter(Boolean).join(' ')}
      classNames={{
        popup: {
          root: [styles.popup, size === 'small' ? styles.compact : '']
            .filter(Boolean)
            .join(' '),
        },
      }}
      styles={popupZIndex === undefined
        ? undefined
        : { popup: { root: { zIndex: popupZIndex } } }}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onOpenChange={onOpenChange}
      onChange={(nextValue) => onChange(nextValue?.toDate() ?? null)}
    />
  )
}
