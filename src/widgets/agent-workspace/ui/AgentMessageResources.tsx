import { FolderOpen, ServerCog, TerminalSquare } from 'lucide-react'
import { Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AgentMessageResource } from '#entities/agent'
import { uiStyles } from '#shared/ui'
import styles from './AgentMessageResources.module.scss'

const resourceIcons = { ssh_session: TerminalSquare, ssh_profile: ServerCog, file_profile: FolderOpen }
const maxResourceNameCharacters = 16
const tooltipClassNames = { root: `${uiStyles.tooltip} termous-tooltip` }

export function AgentMessageResources({ resources }: { resources: AgentMessageResource[] }) {
  const { t } = useTranslation()
  return (
    <div className={styles.resources} role="group" aria-label={t('agent.message.resources')}>
      {resources.map((resource) => {
        const Icon = resourceIcons[resource.kind]
        const kind = t(`agent.message.resourceKind.${resource.kind}`)
        const label = `${kind} · ${resource.name}`
        const characters = Array.from(resource.name)
        const displayName = characters.length > maxResourceNameCharacters
          ? `${characters.slice(0, maxResourceNameCharacters).join('')}…`
          : resource.name
        return (
          <Tooltip key={`${resource.kind}:${resource.id}`} classNames={tooltipClassNames} trigger={['hover', 'focus']} title={(
            <div className={styles.details}>
              <div>{label}</div>
              {resource.host_name && resource.host_name !== resource.name ? <div>{resource.host_name}</div> : null}
              <div>{resource.id}</div>
            </div>
          )}>
            <span className={styles.resource} tabIndex={0} aria-label={label}>
              <Icon size={12} aria-hidden="true" />
              <span className={styles.kind}>{kind}</span>
              <span className={styles.name}>{displayName}</span>
            </span>
          </Tooltip>
        )
      })}
    </div>
  )
}
