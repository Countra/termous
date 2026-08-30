import { Check, ChevronLeft } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentReasoningLevel } from '#entities/agent'
import styles from './AgentResponseOptionsMenu.module.scss'

export function AgentReasoningPickerPane({
  value,
  levels,
  onBack,
  onChange,
}: {
  value: AgentReasoningLevel
  levels: AgentReasoningLevel[]
  onBack: () => void
  onChange: (value: AgentReasoningLevel) => void
}) {
  const { t } = useTranslation()
  const options = useMemo(() => {
    const supported = levels.map((level) => ({ level, disabled: false }))
    if (levels.includes(value)) return supported
    return [{ level: value, disabled: true }, ...supported]
  }, [levels, value])

  return (
    <div className={styles['reasoning-pane']} role="menu" aria-label={t('agent.composer.reasoning')}>
      <button
        type="button"
        className={styles['pane-back']}
        onClick={onBack}
      >
        <ChevronLeft size={13} aria-hidden="true" />
        <span>{t('agent.composer.reasoning')}</span>
      </button>
      <div className={styles['reasoning-options']}>
        {options.map(({ level, disabled }) => (
          <button
            key={level}
            type="button"
            role="menuitemradio"
            aria-checked={level === value}
            aria-label={t(`settings.agent.reasoning.${level}`)}
            className={styles['option-row']}
            disabled={disabled}
            data-pane-focus
            onClick={() => onChange(level)}
          >
            <span>{t(`settings.agent.reasoning.${level}`)}</span>
            {level === value ? <Check size={14} aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
    </div>
  )
}
