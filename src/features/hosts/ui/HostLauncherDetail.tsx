import { Button, Empty, Tooltip } from 'antd'
import {
  Activity,
  Cable,
  Edit3,
  FolderOpen,
  Globe2,
  KeyRound,
  MonitorPlay,
  Network,
  Plus,
  Server,
  Star,
  Tags,
  UserRound,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { HostAvatar } from '#entities/host'
import { ConnectionActionButton, uiStyles } from '#shared/ui'
import {
  type HostLauncherActionId,
  type HostLauncherActionPlan,
} from '../model/hostLauncherIntent.ts'
import {
  tagKey,
} from '../model/hostLauncherListModel.ts'
import { resolveHostLauncherProfileDetails } from '../model/hostLauncherProfileDetails.ts'
import type {
  HostLauncherProfileMenu,
  HostLauncherProfileMenuItem,
} from '../model/hostLauncherProfiles.ts'
import type { HostDirectoryItem } from '../model/hostDirectory.ts'
import type { HostLauncherData } from '../model/types.ts'
import {
  DetailItem,
  HostReachabilityPill,
  LatencyValue,
} from './HostLauncherDetailParts.tsx'
import { HostLauncherProfileAction } from './HostLauncherProfileAction.tsx'

interface HostLauncherDetailProps {
  hasHosts: boolean
  selectedHost?: HostDirectoryItem
  data: HostLauncherData
  actionPlan: HostLauncherActionPlan
  profileMenu: HostLauncherProfileMenu
  selectedProfile: HostLauncherProfileMenuItem | null
  busy: boolean
  pendingHostAction: HostLauncherActionId | null
  pendingProfileId: string | null
  getHostIconUrl: (iconId: string) => string
  canRunAction: (actionId: HostLauncherActionId, hostId: string) => boolean
  onRunAction: (
    actionId: HostLauncherActionId,
    hostId: string,
    profile?: HostLauncherProfileMenuItem,
  ) => void
  onSelectProfile: (profile: HostLauncherProfileMenuItem) => void
  onManageAccess: (hostId: string) => void
  onToggleFavorite: (hostId: string) => Promise<void>
  onClearFilters: () => void
  onCreateHost: () => void
}

export function HostLauncherDetail({
  hasHosts,
  selectedHost,
  data,
  actionPlan,
  profileMenu,
  selectedProfile,
  busy,
  pendingHostAction,
  pendingProfileId,
  getHostIconUrl,
  canRunAction,
  onRunAction,
  onSelectProfile,
  onManageAccess,
  onToggleFavorite,
  onClearFilters,
  onCreateHost,
}: HostLauncherDetailProps) {
  const { t } = useTranslation()

  if (!hasHosts) {
    return (
      <main className="host-launcher-onboarding">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={(
            <div className="host-launcher-onboarding-copy">
              <h2>{t('workbench.hostLauncher.emptyTitle')}</h2>
              <p>{t('workbench.hostLauncher.emptyDescription')}</p>
            </div>
          )}
        >
          <ConnectionActionButton icon={<PlusIcon />} onClick={onCreateHost}>
            {t('hosts.addHost')}
          </ConnectionActionButton>
        </Empty>
      </main>
    )
  }

  if (!selectedHost) {
    return (
      <main className="host-launcher-detail">
        <div className="host-launcher-detail-empty">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={(
              <div className="host-launcher-detail-empty-copy">
                <h3>{t('hosts.noFilterResults')}</h3>
                <p>{t('hosts.noFilterResultsHint')}</p>
              </div>
            )}
          >
            <Button className={`${uiStyles['secondary-button']} secondary-button`} onClick={onClearFilters}>
              {t('workbench.hostLauncher.filters.resetAll')}
            </Button>
          </Empty>
        </div>
      </main>
    )
  }

  const selectedProfileDetails = resolveHostLauncherProfileDetails(data, selectedProfile)
  const selectedReachabilityCandidate = data.hostReachability[selectedHost.id]
  const selectedReachability = selectedProfileDetails?.sshProfileId
    ? data.sshProfileReachability?.[selectedProfileDetails.sshProfileId]
      ?? (selectedReachabilityCandidate?.ssh_profile_id === selectedProfileDetails.sshProfileId
        ? selectedReachabilityCandidate
        : undefined)
    : undefined
  const selectedCredential = selectedProfileDetails?.primaryCredential
  const selectedJump = selectedProfileDetails?.jump
  const selectedProxy = selectedProfileDetails?.proxy

  return (
    <main className="host-launcher-detail">
      <h3 className="host-launcher-overview-title">{t('workbench.hostLauncher.overview')}</h3>
      <div className="host-launcher-hero">
        <HostAvatar
          host={selectedHost}
          getIconUrl={getHostIconUrl}
          className={`host-launcher-hero-icon is-${selectedReachability?.status ?? 'unknown'}`}
          size={58}
          iconSize={34}
        />
        <div className="host-launcher-hero-copy">
          <div className="host-launcher-hero-title">
            <h4>{selectedHost.name}</h4>
            <HostReachabilityPill state={selectedReachability} usesProxy={Boolean(selectedProxy)} />
            <Tooltip title={selectedHost.favorite ? t('workbench.hostLauncher.unfavorite') : t('workbench.hostLauncher.favorite')}>
              <Button
                type="text"
                className={`host-launcher-favorite ${selectedHost.favorite ? 'is-active' : ''}`}
                aria-label={selectedHost.favorite ? t('workbench.hostLauncher.unfavorite') : t('workbench.hostLauncher.favorite')}
                icon={<Star size={16} fill={selectedHost.favorite ? 'currentColor' : 'none'} />}
                disabled={busy}
                onClick={() => void onToggleFavorite(selectedHost.id)}
              />
            </Tooltip>
          </div>
          <div className="host-launcher-hero-meta">
            <span>{selectedProfileDetails?.endpoint || t('fields.none')}</span>
          </div>
        </div>
      </div>
      <dl className="host-launcher-detail-grid">
        <DetailItem icon={<Globe2 size={14} />} label={t('hosts.address')} value={selectedProfileDetails?.endpoint || t('fields.none')} />
        <DetailItem icon={<Server size={14} />} label={t('hosts.platform.label')} value={t('hosts.platform.linux')} />
        <DetailItem icon={<UserRound size={14} />} label={t('hosts.note')} value={selectedHost.note || t('fields.none')} />
        <DetailItem
          icon={<Tags size={14} />}
          label={t('hosts.tags')}
          value={selectedHost.tags.length > 0 ? (
            <span className="host-launcher-inline-tags">
              {selectedHost.tags.map((tag) => <span key={tagKey(tag)}>{tag}</span>)}
            </span>
          ) : t('fields.none')}
        />
        <DetailItem icon={<Activity size={14} />} label={t('workbench.hostLauncher.latency')} value={<LatencyValue state={selectedReachability} />} />
        <DetailItem
          icon={<KeyRound size={14} />}
          label={t('workbench.credential')}
          value={selectedCredential
            ? `${selectedCredential.name} · ${t(`vault.typeName.${selectedCredential.type}`)}`
            : t('fields.none')}
        />
        <DetailItem
          icon={<Network size={14} />}
          label={t('workbench.jumpHost')}
          value={selectedJump
            ? [selectedJump.hostName, selectedJump.profileName].filter(Boolean).join(' · ')
            : t('hosts.noJumpHost')}
        />
        <DetailItem
          icon={<Cable size={14} />}
          label={t('hosts.proxy')}
          value={selectedProxy
            ? `${selectedProxy.name} · ${t(`proxies.types.${selectedProxy.type === 'http_connect' ? 'httpConnect' : 'socks5'}`)}`
            : t('hosts.noProxy')}
        />
      </dl>
      <div className="host-launcher-shortcut-section">
        <span>{t('workbench.hostLauncher.quickActions')}</span>
        <div className="host-launcher-shortcuts">
          {actionPlan.shortcuts.map((actionId) => (
            <Button
              key={actionId}
              className={`${uiStyles['secondary-button']} secondary-button`}
              icon={actionIcon(actionId, 15)}
              loading={pendingHostAction === actionId}
              disabled={busy || !canRunAction(actionId, selectedHost.id)}
              onClick={() => onRunAction(actionId, selectedHost.id)}
            >
              {actionLabel(actionId, t)}
            </Button>
          ))}
        </div>
      </div>
      <HostLauncherProfileAction
        menu={profileMenu}
        data={data}
        selectedItem={selectedProfile}
        busy={busy}
        pendingProfileId={pendingProfileId}
        onSelect={onSelectProfile}
        onManage={() => onManageAccess(selectedHost.id)}
        onRun={(profile) => onRunAction(profile.actionId, selectedHost.id, profile)}
      />
    </main>
  )
}

function PlusIcon() {
  return <Plus size={16} />
}

function actionLabel(
  actionId: HostLauncherActionId,
  t: ReturnType<typeof useTranslation>['t'],
) {
  if (actionId === 'connect') return t('app.connect')
  if (actionId === 'openFiles') return t('workbench.hostLauncher.openFiles')
  if (actionId === 'openRemoteDesktop') return t('workbench.hostLauncher.openRemoteDesktop')
  if (actionId === 'editHost') return t('workbench.hostLauncher.editHost')
  return t('workbench.hostLauncher.openForward')
}

function actionIcon(actionId: HostLauncherActionId, size: number) {
  if (actionId === 'connect') return <Cable size={size} />
  if (actionId === 'editHost') return <Edit3 size={size} />
  if (actionId === 'openFiles') return <FolderOpen size={size} />
  if (actionId === 'openForward') return <Network size={size} />
  return <MonitorPlay size={size} />
}
