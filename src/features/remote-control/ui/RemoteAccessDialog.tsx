import type { ReactNode } from 'react'
import { Button, Grid, Modal, Skeleton, Switch, Tabs } from 'antd'
import { Bot, Folder, Monitor, PanelsTopLeft, Server, Settings2, ShieldCheck } from 'lucide-react'
import type { RemoteAccessMode, RemotePolicy } from '#common/contracts'
import { modalSurfaceStyles, WorkspaceEmptyState, FeedbackMessage, FeedbackMessageScope } from '#shared/ui'
import { type RemoteCopy, remoteErrorText } from '../model/copy'
import styles from './RemoteAccessDialog.module.scss'
import { HostDesktopSharing } from './HostDesktopSharing'
import { RemoteAccessModeControl } from './RemoteAccessModeControl'
import { RemoteAgentAccessPanel, RemoteDesktopAccessPanel, RemoteFolderAccessPanel, RemoteHostAccessPanel } from './RemoteAccessPanels'

interface Props {
  hostDesktopAccesses?: ReactNode
  open: boolean
  copy: RemoteCopy
  policy?: RemotePolicy
  accessMode: RemoteAccessMode
  onAccessMode(mode: RemoteAccessMode): void
  hosts: { id: string; name: string }[]
  selected: string[]
  desktops?: { id: string; host_id: string; name: string; protocol: string }[]
  selectedDesktops?: string[]
  selectedExchanges?: string[]
  onSelectExchanges?(value: string[]): void
  onSelectDesktops?(value: string[]): void
  onDesktops?(): void
  onHostDesktop?(observe: boolean, control: boolean, secureCapture: boolean, secureControl: boolean): void
  enabled: boolean
  loading: boolean
  working?: 'save' | 'agent' | 'directory' | 'desktop' | 'host-desktop'
  error?: unknown
  mustRefresh: boolean
  updated: boolean
  onClose(): void
  onRefresh(): void
  onSave(): void
  onEnabled(value: boolean): void
  onSelect(value: string[]): void
  onAgent(value: boolean): void
  onDirectory(write: boolean, id?: string): void
}

export function RemoteAccessDialog({
  open, copy, policy, accessMode, onAccessMode, hosts, selected, desktops = [], selectedDesktops = [], selectedExchanges = [],
  onSelectExchanges, onSelectDesktops, onDesktops, onHostDesktop, hostDesktopAccesses, enabled, loading, working,
  error, mustRefresh, updated, onClose, onRefresh, onSave, onEnabled, onSelect, onAgent, onDirectory,
}: Props) {
  const screens = Grid.useBreakpoint()
  const inactive = loading || !!working || !policy || mustRefresh
  const full = accessMode === 'full'
  const modePending = !!policy && accessMode !== (policy.access_mode ?? 'custom')
  const detailsInactive = inactive || modePending
  const directories = policy?.directories ?? []
  const savedHosts = new Set((policy?.hosts ?? []).map(host => host.id).filter(id => hosts.some(host => host.id === id)))
  const dirty = !!policy && (modePending || enabled !== policy.enabled || (!full && (savedHosts.size !== selected.length || selected.some(id => !savedHosts.has(id)))))
  const label = (icon: ReactNode, text: string, count?: number) => <span className={styles['tab-label']}>{icon}<span>{text}</span>{count !== undefined ? <span className={styles.count}>{count}</span> : null}</span>

  return <Modal open={open} centered width={920} rootClassName={modalSurfaceStyles.root} className={styles.modal} destroyOnHidden closable={!working} mask={{ closable: !working }} keyboard={!working} onCancel={onClose}
    title={<div className={styles.title}><span className={styles['title-icon']}><ShieldCheck size={21} aria-hidden="true" /></span><div><strong>{copy.configure}</strong><p>{copy.trustedScope}</p></div></div>}
    footer={<div className={styles.footer}>
      <span className={`${styles['footer-hint']} ${dirty ? styles.pending : ''}`}>{dirty ? copy.pendingHosts : full ? copy.fullSaveHint : copy.hostSaveHint}</span>
      <div className={styles['footer-actions']}>{policy && error ? <Button disabled={!!working} onClick={onRefresh}>{copy.refresh}</Button> : null}<Button disabled={!!working} onClick={onClose}>{copy.close}</Button><Button type="primary" loading={working === 'save'} disabled={inactive} onClick={onSave}>{copy.saveHosts}</Button></div>
    </div>}><FeedbackMessageScope active={open}>
      <div className={styles.body}>
        {error && !loading ? <FeedbackMessage type="warning" title={policy ? remoteErrorText(copy, error) : copy.accessReadFailed} description={!policy ? remoteErrorText(copy, error) : undefined} /> : null}
        {loading ? <div className={styles.loading} role="status" aria-label={copy.accessLoading}><Skeleton active paragraph={{ rows: 5 }} /></div> : !policy ? <WorkspaceEmptyState icon={<Settings2 size={18} />} title={copy.configure} action={<Button onClick={onRefresh}>{copy.refresh}</Button>} /> : <>
          <div className={styles['remote-control']}><h3>{copy.hostSettings}</h3><Switch checked={enabled} disabled={inactive} onChange={onEnabled} aria-label={copy.hostSettings} /></div>
          <RemoteAccessModeControl mode={accessMode} copy={copy} disabled={inactive} pending={modePending} onChange={onAccessMode} />
          <Tabs key={`${open}-${accessMode}`} className={styles.tabs} tabPlacement={screens.md ? 'start' : 'top'} defaultActiveKey={full ? 'folders' : 'hosts'} animated={false} items={[
            ...(!full ? [{
              key: 'hosts',
              label: label(<Server size={16} aria-hidden="true" />, copy.hostConnections, selected.length),
              children: <RemoteHostAccessPanel copy={copy} hosts={hosts} selected={selected} disabled={detailsInactive} onSelect={onSelect} />,
            }] : []),
            ...(onHostDesktop ? [{
              key: 'host-desktop',
              label: label(<Monitor size={16} aria-hidden="true" />, copy.deviceDesktop),
              children: <>
                {!full ? <HostDesktopSharing policy={policy} disabled={detailsInactive} working={working === 'host-desktop'} change={onHostDesktop} /> : null}
                {hostDesktopAccesses}
              </>,
            }] : []),
            {
              key: 'folders',
              label: label(<Folder size={16} aria-hidden="true" />, copy.allowedFolders, directories.length),
              children: <RemoteFolderAccessPanel copy={copy} directories={directories} full={full} disabled={detailsInactive} onDirectory={onDirectory} />,
            },
            ...(!full && onDesktops ? [{
              key: 'desktops',
              label: label(<PanelsTopLeft size={16} aria-hidden="true" />, copy.desktopAccess, selectedDesktops.length),
              children: <RemoteDesktopAccessPanel
                copy={copy} hosts={hosts} desktops={desktops.filter(profile => savedHosts.has(profile.host_id))}
                selected={selectedDesktops} exchanges={selectedExchanges} disabled={inactive || dirty} pending={dirty}
                working={working === 'desktop'} onSelect={onSelectDesktops} onExchanges={onSelectExchanges} onSave={onDesktops}
              />,
            }] : []),
            ...(!full ? [{
              key: 'agent',
              label: label(<Bot size={16} aria-hidden="true" />, copy.agent),
              children: <RemoteAgentAccessPanel copy={copy} enabled={policy.agent_enabled === true} disabled={detailsInactive} working={working === 'agent'} onChange={onAgent} />,
            }] : []),
          ]} />
          {updated && !error ? <FeedbackMessage type="success" title={copy.accessUpdated} /> : null}
        </>}
      </div>
    </FeedbackMessageScope></Modal>
}
