import { forwardRef, useEffect, useId, useRef, type CSSProperties, type InputHTMLAttributes } from 'react'
import { Form } from 'antd'
import { useTranslation } from 'react-i18next'
import styles from './AccountTOTPInput.module.scss'

interface Props extends Pick<InputHTMLAttributes<HTMLInputElement>, 'id' | 'disabled' | 'autoFocus' | 'aria-describedby' | 'aria-invalid' | 'aria-required'> {
  value?: string
  onChange?: (value: string) => void
  onComplete?: (value: string) => void
  /** 数字格之间的水平间距，单位为像素，不改变数字格的标准宽度。 */
  gap?: number
}

const length = 6

export const AccountTOTPInput = forwardRef<HTMLInputElement, Props>(function AccountTOTPInput({ value = '', onChange, onComplete, disabled, autoFocus, gap, id, ...aria }, ref) {
  const { t } = useTranslation()
  const fallbackId = useId()
  const { status } = Form.Item.useStatus()
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const focused = useRef(false)
  useEffect(() => {
    if (autoFocus && !disabled && !focused.current) { focused.current = true; inputs.current[0]?.focus() }
  }, [autoFocus, disabled])
  const digits = Array.from({ length }, (_, index) => /^[0-9]$/.test(value[index] ?? '') ? value[index] : '')
  const focus = (index: number) => { inputs.current[Math.max(0, Math.min(index, length - 1))]?.focus() }
  const update = (next: string[], nextFocus: number) => {
    // 保留中间空位，删除某一位时不能让后面的数字左移成另一组验证码。
    const code = next.map(digit => digit || ' ').join('').trimEnd()
    onChange?.(code)
    focus(nextFocus)
    if (/^[0-9]{6}$/.test(code) && code !== value) onComplete?.(code)
  }
  const write = (text: string, index: number) => {
    if (disabled || !/^[0-9\s-]*$/.test(text)) return
    const incoming = text.replace(/[\s-]/g, '')
    if (incoming.length > length) return
    const start = incoming.length === length ? 0 : index
    const next = [...digits]
    if (!incoming) next[index] = ''
    else incoming.split('').slice(0, length - start).forEach((digit, offset) => { next[start + offset] = digit })
    update(next, incoming ? start + incoming.length : index)
  }

  return <div className={styles.code} style={{ '--totp-gap': gap === undefined ? undefined : `${gap}px` } as CSSProperties} role="group" aria-label={t('cloud.mfa.codeGroup')} data-status={status}>
    {digits.map((digit, index) => <input key={index} {...aria}
      ref={element => {
        inputs.current[index] = element
        if (index === 0) { if (typeof ref === 'function') ref(element); else if (ref) ref.current = element }
      }}
      id={index === 0 ? id ?? fallbackId : `${id ?? fallbackId}-${index + 1}`}
      aria-label={index === 0 ? undefined : t('cloud.mfa.digit', { position: index + 1 })}
      aria-invalid={aria['aria-invalid'] || status === 'error'}
      autoComplete={index === 0 ? 'one-time-code' : 'off'} inputMode="numeric" type="text" pattern="[0-9]*"
      autoFocus={autoFocus && index === 0} disabled={disabled} value={digit} placeholder="·" spellCheck={false}
      onFocus={event => event.currentTarget.select()} onClick={event => event.currentTarget.select()}
      onChange={event => {
        // 移动端键盘可能在当前数字前后插入字符；优先使用实际输入，避免把旧数字再次写回。
        const input = event.nativeEvent as InputEvent
        write(input.data ?? event.target.value, index)
      }}
      onPaste={event => { event.preventDefault(); write(event.clipboardData.getData('text'), index) }}
      onKeyDown={event => {
        if (disabled || event.altKey || event.ctrlKey || event.metaKey) return
        if (/^[0-9]$/.test(event.key)) {
          event.preventDefault()
          write(event.key, index)
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
          event.preventDefault()
          focus(event.key === 'Home' ? 0 : event.key === 'End' ? length - 1 : index + (event.key === 'ArrowLeft' ? -1 : 1))
        } else if (event.key === 'Backspace' || event.key === 'Delete') {
          event.preventDefault()
          const target = event.key === 'Backspace' && !digit ? Math.max(0, index - 1) : index
          const next = [...digits]; next[target] = ''; update(next, target)
        }
      }} />)}
  </div>
})
