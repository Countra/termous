import { App as AntdApp, Tooltip } from 'antd'
import { CornerDownLeft, Send, TriangleAlert } from 'lucide-react'
import { useId, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { uiStyles } from '#shared/ui'
import { containsCommandLineBreak } from '../model/commandDispatchSelection'
import styles from './CommandDispatchComposer.module.scss'

interface CommandDispatchComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  inputRef: RefObject<HTMLTextAreaElement | null>
  canSend: boolean
  busy: boolean
  invalid: boolean
  validationMessage: string
  targetCount: number
}

const tooltipClassNames = { root: `${uiStyles.tooltip} termous-tooltip` }

export function CommandDispatchComposer({
  value,
  onChange,
  onSubmit,
  inputRef,
  canSend,
  busy,
  invalid,
  validationMessage,
  targetCount,
}: CommandDispatchComposerProps) {
  const { t } = useTranslation()
  const { message } = AntdApp.useApp()
  const validationId = useId()
  return (
    <section className={styles.root} aria-label={t('commandDispatch.editor')}>
      <header className={styles.header}>
        <strong>{t('commandDispatch.editor')}</strong>
        {validationMessage ? (
          <span className={styles.validation}>{validationMessage}</span>
        ) : (
          <span className={styles.hint}>{t('commandDispatch.enterToSend')}<CornerDownLeft size={12} aria-hidden="true" /></span>
        )}
      </header>
      <div className={styles.editor} data-invalid={invalid || undefined}>
        <span className={styles.prompt} aria-hidden="true">$</span>
        <textarea
          ref={inputRef}
          value={value}
          rows={2}
          wrap="soft"
          maxLength={8192}
          autoComplete="off"
          spellCheck={false}
          aria-label={t('commandDispatch.commandInput')}
          aria-invalid={invalid || undefined}
          aria-describedby={validationMessage ? validationId : undefined}
          placeholder={t('commandDispatch.commandPlaceholder')}
          data-command-dispatch-input=""
          onChange={(event) => {
            // 软换行只影响显示；拖放或输入法插入的真实换行仍需拒绝。
            if (containsCommandLineBreak(event.target.value)) {
              void message.warning(t('commandDispatch.multilineRejected'))
              return
            }
            onChange(event.target.value)
          }}
          onPaste={(event) => {
            if (!containsCommandLineBreak(event.clipboardData.getData('text/plain'))) return
            event.preventDefault()
            void message.warning(t('commandDispatch.multilineRejected'))
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            // 长按回车产生的重复按键不能创建新的命令任务。
            if (!event.repeat && canSend) onSubmit()
          }}
        />
      </div>
      <footer className={styles.footer}>
        <span className={styles.count}>
          {targetCount ? t('commandDispatch.targetCount', { count: targetCount }) : t('commandDispatch.noTargets')}
        </span>
        {validationMessage ? (
          <Tooltip title={validationMessage} classNames={tooltipClassNames} trigger={['hover', 'focus']}>
            <span id={validationId} className={styles['validation-icon']} role="alert" tabIndex={0}>
              <TriangleAlert size={15} aria-hidden="true" />
              <span className={styles['validation-message']}>{validationMessage}</span>
            </span>
          </Tooltip>
        ) : null}
        <button
          type="button"
          className={styles.send}
          disabled={!canSend}
          aria-label={busy ? t('commandDispatch.sending') : t('commandDispatch.sendToCount', { count: targetCount })}
          aria-busy={busy || undefined}
          data-command-dispatch-send=""
          onClick={onSubmit}
        >
          <Send size={14} aria-hidden="true" />
          <span>{busy ? t('commandDispatch.sending') : t('commandDispatch.execute')}</span>
          {targetCount > 1 ? <small className={styles['send-count']} aria-hidden="true">{targetCount}</small> : null}
        </button>
      </footer>
    </section>
  )
}
