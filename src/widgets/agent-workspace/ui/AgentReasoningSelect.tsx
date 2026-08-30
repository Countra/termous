import { BrainCircuit } from 'lucide-react'
import { Select } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentReasoningLevel } from '#entities/agent'
import { customSelectStyles } from '#shared/ui'
import styles from './AgentReasoningSelect.module.scss'

export function AgentReasoningSelect({
  value,
  levels,
  disabled,
  onChange,
}: {
  value: AgentReasoningLevel
  levels: AgentReasoningLevel[]
  disabled: boolean
  onChange: (value: AgentReasoningLevel) => void
}) {
  const { t } = useTranslation()
  const options = useMemo(() => {
    const supported = levels.map((level) => ({
      value: level,
      label: t(`settings.agent.reasoning.${level}`),
    }))
    if (levels.includes(value)) return supported
    return [{
      value,
      label: t(`settings.agent.reasoning.${value}`),
      disabled: true,
    }, ...supported]
  }, [levels, t, value])
  const label = t(`settings.agent.reasoning.${value}`)

  return (
    <Select<AgentReasoningLevel>
      className={styles.select}
      value={value}
      disabled={disabled}
      aria-label={t('agent.composer.reasoning')}
      title={`${t('agent.composer.reasoning')} · ${label}`}
      prefix={<BrainCircuit size={13} aria-hidden="true" />}
      variant="borderless"
      popupMatchSelectWidth={116}
      virtual={false}
      classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
      options={options}
      onChange={(nextValue) => onChange(nextValue)}
    />
  )
}
