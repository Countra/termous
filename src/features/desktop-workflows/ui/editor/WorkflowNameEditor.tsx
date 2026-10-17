import { Button, Input } from 'antd'
import { Check, Pencil, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './WorkflowNameEditor.module.scss'

export function WorkflowNameEditor({ value, disabled, onChange }: {
  value: string; disabled: boolean; onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const original = useRef(value)
  const input = useRef<import('antd').InputRef>(null)
  const finish = (cancel = false) => {
    const next = cancel ? original.current : (input.current?.input?.value ?? value).trim() || original.current
    if (next !== value) onChange(next)
    setEditing(false)
  }
  if (!editing) return <h2 className={styles.title} aria-label={value || t('desktopWorkflow.newScript')}>
    <button type="button" className={styles.trigger} aria-label={t('desktopWorkflow.editName')} title={value} disabled={disabled}
      onClick={() => { original.current = value; setEditing(true) }}>
      <span>{value || t('desktopWorkflow.newScript')}</span><Pencil size={13} aria-hidden />
    </button>
  </h2>
  return <div className={styles.editor} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) finish()
  }}>
    <Input ref={input} autoFocus variant="borderless" aria-label={t('desktopWorkflow.scriptName')} maxLength={120}
      value={value} disabled={disabled} onFocus={event => event.target.select()} onChange={event => onChange(event.target.value)}
      onKeyDown={event => {
        // 输入法的确认键只负责选字，不能提前结束名称编辑。
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); finish(event.key === 'Escape') }
      }} />
    <div className={styles.actions}>
      <Button type="text" size="small" icon={<Check size={14} />} aria-label={t('desktopWorkflow.confirmName')} disabled={disabled} onClick={() => finish()} />
      <Button type="text" size="small" icon={<X size={14} />} aria-label={t('desktopWorkflow.cancel')} disabled={disabled} onClick={() => finish(true)} />
    </div>
  </div>
}
