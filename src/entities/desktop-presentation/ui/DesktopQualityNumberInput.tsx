import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsNumberInput } from '#shared/ui'
import styles from './DesktopPresentationControls.module.scss'

type Props = Omit<ComponentProps<typeof SettingsNumberInput>, 'value' | 'onChange' | 'onBlur' | 'onPressEnter' | 'onInput' | 'onKeyDown'> & {
  value: number
  commitOnBlur?: boolean
  onChange(value: number): void
}

// 默认设置完成一次编辑后提交；会话内控件仍即时通知呈现协调器。
export function DesktopQualityNumberInput({ value, commitOnBlur = false, onChange, ...props }: Props) {
  const { i18n } = useTranslation()
  const [draft, setDraft] = useState<number | null>(value)
  const [invalid, setInvalid] = useState(false)
  const current = useRef(String(value))
  const editing = useRef(false)
  useEffect(() => {
    if (editing.current) return
    current.current = String(value)
    setDraft(value)
    setInvalid(false)
  }, [value])
  const commit = () => {
    if (!commitOnBlur || !editing.current || props.disabled) return
    editing.current = false
    const next = Number(current.current)
    if (!current.current.trim() || !Number.isFinite(next) || next < Number(props.min ?? -Infinity) || next > Number(props.max ?? Infinity)
      || props.precision !== undefined && Number(next.toFixed(props.precision)) !== next) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    if (next !== value) onChange(next)
  }
  const errorId = `${props.id}-error`
  return <>
    <SettingsNumberInput {...props} value={commitOnBlur ? draft : value}
      changeOnBlur={commitOnBlur ? false : props.changeOnBlur}
      status={invalid ? 'error' : props.status} aria-invalid={invalid || undefined}
      aria-describedby={[props['aria-describedby'], invalid ? errorId : undefined].filter(Boolean).join(' ') || undefined}
      onChange={next => {
        if (commitOnBlur) { editing.current = true; current.current = next === null ? '' : String(next); setDraft(next); setInvalid(false) }
        else if (next !== null) onChange(next)
      }}
      onInput={raw => {
        // 越界输入不会触发数值 onChange，仍需保留原文供提交时校验。
        if (commitOnBlur) { editing.current = true; current.current = raw; setInvalid(false) }
      }}
      onKeyDown={event => {
        if (!commitOnBlur || event.key !== 'Enter' || event.nativeEvent.isComposing) return
        // 在底层输入框自动修正数值前校验，避免回车将越界值静默保存。
        event.preventDefault()
        event.stopPropagation()
        commit()
      }}
      onBlur={commit} />
    {invalid && <p id={errorId} className={styles['field-error']} role="alert">{i18n?.language?.startsWith('zh') ? `请输入 ${props.min}～${props.max} 范围内的有效数值。` : `Enter a valid number from ${props.min} to ${props.max}.`}</p>}
  </>
}
