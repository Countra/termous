import { useEffect, useState, type ReactNode } from 'react'
import { Button, Grid, Modal, Popconfirm, Skeleton, Switch, Tabs } from 'antd'
import { Bot, Folder, Monitor, PanelsTopLeft, RotateCw, Server, Settings2, ShieldCheck } from 'lucide-react'
import type { RemotePolicyChange } from '#common/contracts'
import { modalSurfaceStyles, termousPopconfirmProps, WorkspaceEmptyState } from '#shared/ui'
import type { RemoteCopy } from '../model/copy'
import type { PolicyEditorState } from '../model/policyEditor'
import styles from './RemoteAccessDialog.module.scss'
import { HostDesktopSharing } from './HostDesktopSharing'
import { RemoteAccessModeControl } from './RemoteAccessModeControl'
import { RemoteAccessFeedback } from './RemoteAccessFeedback'
import { RemoteAgentAccessPanel, RemoteDesktopAccessPanel, RemoteFolderAccessPanel, RemoteHostAccessPanel } from './RemoteAccessPanels'

interface Props {
  hostDesktopAccesses?: ReactNode; copy: RemoteCopy; state: PolicyEditorState
  change(value: RemotePolicyChange): void
  onClose(): void; onRefresh(): void; onDirectory(write: boolean): void
}

export function RemoteAccessDialog({ hostDesktopAccesses, copy, state, change, onClose, onRefresh, onDirectory }: Props) {
  const screens = Grid.useBreakpoint()
  const [confirmation, setConfirmation] = useState<RemotePolicyChange>()
  const [activeTab, setActiveTab] = useState('hosts')
  const { view, pending, loading, blocked, picking, open } = state
  useEffect(() => { if (!open) setConfirmation(undefined) }, [open])
  const policy = view?.policy
  const full = policy?.access_mode === 'full'
  const inactive = loading || blocked || !policy
  const busy = pending.size > 0 || picking
  const selected = (policy?.hosts ?? []).filter(h => h.terminal_file_access !== false).map(h => h.id)
  const selectedDesktops = (policy?.hosts ?? []).flatMap(h => (h.connections ?? []).filter(g => g.kind === 'desktop').map(g => g.id))
  const selectedExchanges = (policy?.hosts ?? []).flatMap(h => (h.connections ?? []).filter(g => g.kind === 'desktop_exchange').map(g => g.id))
  const fullHosts = (view?.hosts ?? []).filter(h => h.status !== 'unavailable').map(h => h.id)
  const fullDesktops = (view?.desktops ?? []).filter(d => d.status !== 'unavailable').map(d => d.id)
  const label = (icon: ReactNode, text: string, count?: number) => <span className={styles['tab-label']}>{icon}<span>{text}</span>{count !== undefined ? <span className={styles.count}>{count}</span> : null}</span>
  const modeChange = (value: RemotePolicyChange) => {
    const enablesFull = value.kind === 'mode' && value.mode === 'full' && policy?.enabled || value.kind === 'enabled' && value.enabled && full
    if (!enablesFull) { change(value); return }
    setConfirmation(value)
  }
  const confirmProps = {
    ...termousPopconfirmProps, title: copy.confirmFullTitle, description: copy.fullControlHint,
    okText: copy.confirmFull, cancelText: copy.cancel, onCancel: () => setConfirmation(undefined),
    onConfirm: () => { if (confirmation) change(confirmation); setConfirmation(undefined) },
  }
  return <Modal open={open} centered width={920} rootClassName={modalSurfaceStyles.root} className={styles.modal} destroyOnHidden closable={!busy} mask={{ closable: !busy }} keyboard={!busy} onCancel={onClose}
    title={<div className={styles.title}><span className={styles['title-icon']}><ShieldCheck size={21} aria-hidden="true" /></span><div><strong>{copy.configure}</strong><p>{copy.trustedScope}</p></div></div>}
    footer={null}>
    <RemoteAccessFeedback notice={state.notice} copy={copy} active={open} />
    <div className={styles.body}>
      {loading ? <div className={styles.loading} role="status" aria-label={copy.accessLoading}><Skeleton active paragraph={{ rows: 5 }} /></div> : !policy || !view ? <WorkspaceEmptyState icon={<Settings2 size={18} />} title={copy.accessReadFailed} action={<Button onClick={onRefresh}>{copy.refresh}</Button>} /> : <>
        <div className={styles['remote-control']}><h3>{copy.hostSettings}</h3>{blocked ? <Button type="text" size="small" icon={<RotateCw size={14} aria-hidden="true" />} onClick={onRefresh}>{copy.refresh}</Button> : null}<Popconfirm {...confirmProps} trigger={[]} open={open && confirmation?.kind === 'enabled'}><Switch checked={policy.enabled} disabled={inactive || pending.has('enabled')} loading={pending.has('enabled')} onChange={enabled => modeChange({ kind: 'enabled', enabled })} aria-label={copy.hostSettings} /></Popconfirm></div>
        <Popconfirm {...confirmProps} trigger={[]} open={open && confirmation?.kind === 'mode'}><div className={styles['mode-control']}><RemoteAccessModeControl mode={policy.access_mode ?? 'custom'} copy={copy} disabled={inactive || pending.has('mode')} onChange={mode => modeChange({ kind: 'mode', mode })} /></div></Popconfirm>
        <Tabs className={styles.tabs} tabPlacement={screens.md ? 'start' : 'top'} activeKey={activeTab} onChange={setActiveTab} animated={false} items={[
          { key: 'hosts', label: label(<Server size={16} aria-hidden="true" />, copy.hostConnections, full ? fullHosts.length : selected.length),
            children: <RemoteHostAccessPanel copy={copy} hosts={view.hosts} selected={full ? fullHosts : selected} full={full} disabled={inactive || full} pending={pending} onChange={change} /> },
          { key: 'desktops', label: label(<PanelsTopLeft size={16} aria-hidden="true" />, copy.desktopAccess, full ? fullDesktops.length : selectedDesktops.length),
            children: <RemoteDesktopAccessPanel copy={copy} hosts={view.hosts} desktops={view.desktops} selected={full ? fullDesktops : selectedDesktops} full={full}
              exchanges={full ? view.desktops.filter(d => d.protocol === 'rdp' && d.status !== 'unavailable').map(d => d.id) : selectedExchanges} disabled={inactive || full} pending={pending} onChange={change} /> },
          { key: 'host-desktop', label: label(<Monitor size={16} aria-hidden="true" />, copy.deviceDesktop), children: <>
            <HostDesktopSharing policy={full ? { ...policy, host_desktop: { observe: true, control: true, secure_capture: true, secure_control: true } } : policy}
              disabled={inactive || full || pending.has('host_desktop')} working={pending.has('host_desktop')}
              change={(observe, control, secure_capture, secure_control) => change({ kind: 'host_desktop', host_desktop: { observe, control, secure_capture, secure_control } })} />
            {hostDesktopAccesses}</> },
          { key: 'folders', label: label(<Folder size={16} aria-hidden="true" />, copy.allowedFolders, policy.directories?.length ?? 0),
            children: <RemoteFolderAccessPanel copy={copy} directories={policy.directories ?? []} full={full} disabled={inactive} pending={pending} picking={picking}
              onDirectory={(write, id) => id ? change({ kind: 'directory_remove', directory_id: id }) : onDirectory(write)} /> },
          { key: 'agent', label: label(<Bot size={16} aria-hidden="true" />, copy.agent),
            children: <RemoteAgentAccessPanel copy={copy} enabled={full || policy.agent_enabled === true} disabled={inactive || full || pending.has('agent')} working={pending.has('agent')} onChange={enabled => change({ kind: 'agent', enabled })} /> },
        ]} />
      </>}
    </div>
  </Modal>
}
