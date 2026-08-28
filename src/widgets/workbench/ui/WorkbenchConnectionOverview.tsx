import { Button } from 'antd'
import { Bot, FolderOpen, Power, RotateCcw, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ComponentProps } from 'react'
import { HostAvatar } from '#entities/host'
import { StatusBadge, uiStyles, WorkspaceEmptyState as WorkbenchEmptyState } from '#shared/ui'
import type { CredentialView } from '#entities/credential'
import type { ConnectionProxy } from '#entities/connection-proxy'
import type { Host, HostGroup } from '#entities/host'
import type { Session } from '#entities/session'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import {
  buildWorkbenchAgentLaunchRequest,
  type AgentLaunchRequest,
} from '#entities/agent'
import styles from './WorkbenchDetails.module.scss'

interface WorkbenchConnectionOverviewProps {
  data: WorkbenchConnectionData
  session: Session | null
  actionBusy: boolean
  sessionClosing: boolean
  sessionBadgeStatus: ComponentProps<typeof StatusBadge>['status']
  sessionStatusLabel: string
  sessionStateLabel: string
  getHostIconUrl: (iconId: string) => string
  onOpenFiles: (session: Session) => Promise<void>
  onReconnect: () => Promise<void>
  onClose: (sessionId: string) => Promise<boolean>
  onLaunchAgent?: (intent: AgentLaunchRequest) => void
}

interface WorkbenchConnectionData {
  hosts: Host[]
  groups: HostGroup[]
  proxies: ConnectionProxy[]
  credentials: CredentialView[]
  sshAccessProfiles: SSHAccessProfile[]
}

export function WorkbenchConnectionOverview({
  data,
  session,
  actionBusy,
  sessionClosing,
  sessionBadgeStatus,
  sessionStatusLabel,
  sessionStateLabel,
  getHostIconUrl,
  onOpenFiles,
  onReconnect,
  onClose,
  onLaunchAgent,
}: WorkbenchConnectionOverviewProps) {
  const { t } = useTranslation()
  const host = session?.kind === 'ssh'
    ? data.hosts.find((candidate) => candidate.id === session.host_id)
    : undefined
  const sshProfile = session?.kind === 'ssh'
    ? data.sshAccessProfiles.find((candidate) => candidate.id === session.ssh_profile_id)
    : undefined
  if (!host) {
    return (
      <WorkbenchEmptyState
        icon={<Server size={20} />}
        title={t('workbench.connectionOverview.emptyTitle')}
        description={t('workbench.connectionOverview.emptyHint')}
      />
    )
  }
  if (!sshProfile) {
    return (
      <WorkbenchEmptyState
        icon={<Server size={20} />}
        title={t('workbench.connectionOverview.profileUnavailable')}
        description={t('workbench.connectionOverview.profileUnavailableHint')}
      />
    )
  }

  const credential = data.credentials.find((item) => item.id === sshProfile.credential_id)
  const group = data.groups.find((item) => item.id === host.group_id)
  const jumpSSHProfile = data.sshAccessProfiles.find((item) => item.id === session?.jump_ssh_profile_id)
  const jumpHost = data.hosts.find((item) => item.id === jumpSSHProfile?.host_id)
  const proxy = data.proxies.find((item) => item.id === session?.proxy_id)
  const tags = host.tags ?? []
  const credentialLabel = credential
    ? `${credential.name} (${t(`vault.typeName.${credential.type}`)})`
    : t('fields.none')
  const sessionEnded = session?.status === 'disconnected' || session?.status === 'failed'
  const canOpenFiles = session?.status === 'connected' && Boolean(session.host_id)
  const canReconnect = Boolean(session?.ssh_profile_id && sessionEnded)

  return (
    <div className={styles['connection-overview-panel']}>
      <div className={styles['connection-overview-hero']}>
        <HostAvatar
          host={host}
          getIconUrl={getHostIconUrl}
          className={styles['connection-overview-icon']}
          size={42}
          iconSize={22}
        />
        <div className={styles['connection-overview-copy']}>
          <strong>{host.name}</strong>
          <small>{`${sshProfile.username}@${sshProfile.address}:${sshProfile.port}`}</small>
        </div>
        <StatusBadge status={sessionBadgeStatus} label={sessionStatusLabel} />
      </div>
      <dl className={styles['detail-list']}>
        <div>
          <dt>{t('hosts.address')}</dt>
          <dd>{`${sshProfile.address}:${sshProfile.port}`}</dd>
        </div>
        <div>
          <dt>{t('hosts.username')}</dt>
          <dd>{sshProfile.username}</dd>
        </div>
        <div>
          <dt>{t('hosts.platform.label')}</dt>
          <dd>{host.platform === 'linux' ? t('hosts.platform.linux') : t('fields.none')}</dd>
        </div>
        <div>
          <dt>{t('hosts.group')}</dt>
          <dd>{group?.name ?? t('hosts.ungrouped')}</dd>
        </div>
        <div>
          <dt>{t('hosts.authMethod')}</dt>
          <dd>{t(`hosts.auth.${sshProfile.auth_method}`)}</dd>
        </div>
        <div>
          <dt>{t('workbench.credential')}</dt>
          <dd>{credentialLabel}</dd>
        </div>
        <div>
          <dt>{t('workbench.sessionState')}</dt>
          <dd>{sessionStateLabel}</dd>
        </div>
        <div>
          <dt>{t('hosts.tags')}</dt>
          <dd className={styles['connection-overview-tags-cell']}>
            {tags.length > 0 ? (
              <span className={styles['connection-overview-tags']}>
                {tags.map((tag, index) => (
                  <span key={`${tag}-${index}`}>{tag}</span>
                ))}
              </span>
            ) : t('fields.none')}
          </dd>
        </div>
        <div>
          <dt>{t('workbench.jumpHost')}</dt>
          <dd>{jumpSSHProfile
            ? `${jumpHost?.name ?? t('fields.none')} / ${jumpSSHProfile.name}`
            : t('fields.none')}</dd>
        </div>
        <div>
          <dt>{t('hosts.proxy')}</dt>
          <dd>{proxy
            ? `${proxy.name} · ${t(`proxies.types.${proxy.type === 'http_connect' ? 'httpConnect' : 'socks5'}`)}`
            : t('hosts.noProxy')}</dd>
        </div>
        <div>
          <dt>{t('hosts.note')}</dt>
          <dd>{host.note || t('fields.none')}</dd>
        </div>
      </dl>
      <div className={styles['current-connection-actions']}>
        {onLaunchAgent ? <Button
          className={`${uiStyles['secondary-button']} secondary-button`}
          disabled={actionBusy}
          icon={<Bot size={16} />}
          onClick={() => onLaunchAgent(buildWorkbenchAgentLaunchRequest({
            hostId: host.id,
            sshProfileId: sshProfile.id,
            connectionStatus: session?.status ?? 'disconnected',
            title: t('agent.launch.title.workbench', { name: host.name }),
            summary: t('agent.launch.summary.workbench', { status: sessionStateLabel }),
          }))}
        >
          {t('agent.launch.action')}
        </Button> : null}
        <Button
          className={`${uiStyles['secondary-button']} secondary-button`}
          disabled={!canOpenFiles || actionBusy || !session}
          onClick={() => session && void onOpenFiles(session)}
          icon={<FolderOpen size={16} />}
        >
          {t('workbench.manageFiles')}
        </Button>
        {canReconnect ? (
          <Button
            className={`${uiStyles['secondary-button']} secondary-button`}
            disabled={actionBusy}
            onClick={() => void onReconnect()}
            icon={<RotateCcw size={16} />}
          >
            {t('workbench.reconnectSession')}
          </Button>
        ) : null}
        <Button
          danger
          className={`${uiStyles['danger-button']} danger-button`}
          disabled={!session || (actionBusy && !sessionClosing)}
          loading={sessionClosing}
          onClick={() => session && void onClose(session.id)}
          icon={<Power size={16} />}
        >
          {sessionClosing
            ? t('workbench.closingSession')
            : sessionEnded
              ? t('workbench.closeDisconnectedSession')
              : t('workbench.closeSession')}
        </Button>
      </div>
    </div>
  )
}
