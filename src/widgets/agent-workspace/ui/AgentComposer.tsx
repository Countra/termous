import { CornerDownLeft, Send, Square, Waypoints } from 'lucide-react'
import { Button, Input, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AgentWorkspaceRunStatus } from '../model/types.ts'
import { isActiveAgentRun } from '../model/types.ts'
import styles from './AgentComposer.module.scss'

export function AgentComposer({
  value,
  runStatus,
  disabled,
  submitDisabled,
  onChange,
  onSend,
  onSteer,
  onStop,
}: {
  value: string
  runStatus: AgentWorkspaceRunStatus
  disabled: boolean
  submitDisabled: boolean
  onChange: (value: string) => void
  onSend: (value: string) => void
  onSteer: (value: string) => void
  onStop: () => void
}) {
  const { t } = useTranslation()
  const active = isActiveAgentRun(runStatus)
  const submit = () => {
    if (!value.trim() || submitDisabled || runStatus === 'stopping') return
    if (active) onSteer(value)
    else onSend(value)
  }
  return (
    <div className={styles.composer}>
      {active ? (
        <div className={styles['composer-context']}><Waypoints size={13} />{t('agent.composer.steerHint')}</div>
      ) : null}
      <div className={styles['composer-input']}>
        <Input.TextArea
          autoSize={{ minRows: 1, maxRows: 7 }}
          value={value}
          disabled={disabled && !active}
          placeholder={t(active ? 'agent.composer.steerPlaceholder' : 'agent.composer.placeholder')}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className={styles['composer-actions']}>
          {active ? (
            <Tooltip title={t('agent.composer.stop')}>
              <Button danger aria-label={t('agent.composer.stop')} icon={<Square size={14} fill="currentColor" />} disabled={disabled || runStatus === 'stopping'} onClick={onStop} />
            </Tooltip>
          ) : null}
          <Button
            type="primary"
            icon={active ? <CornerDownLeft size={15} /> : <Send size={15} />}
            disabled={submitDisabled || !value.trim() || runStatus === 'stopping'}
            onClick={submit}
          >
            {t(active ? 'agent.composer.steer' : 'agent.composer.send')}
          </Button>
        </div>
      </div>
    </div>
  )
}
