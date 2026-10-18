import { useEffect, useState, type ReactNode } from 'react'
import { Button, Checkbox, Input, Modal, Popconfirm, Skeleton, Switch, Tabs, Tag } from 'antd'
import { Bot, Folder, FolderPlus, Monitor, Search, Server, Settings2, ShieldCheck, Trash2 } from 'lucide-react'
import type { RemotePolicy } from '#common/contracts'
import { modalSurfaceStyles, termousPopconfirmProps, WorkspaceEmptyState, FeedbackMessage, FeedbackMessageScope } from '#shared/ui'
import { type RemoteCopy, remoteErrorText } from '../model/copy'
import styles from './RemoteAccessDialog.module.scss'

interface Props {
  open: boolean
  copy: RemoteCopy
  policy?: RemotePolicy
  hosts: { id: string; name: string }[]
  selected: string[]
  desktops?: { id: string; host_id: string; name: string; protocol: string }[]
  selectedDesktops?: string[]
  selectedExchanges?: string[]
  onSelectExchanges?(value: string[]): void
  onSelectDesktops?(value: string[]): void
  onDesktops?(): void
  enabled: boolean
  loading: boolean
  working?: 'save' | 'agent' | 'directory' | 'desktop'
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

export function RemoteAccessDialog({ open, copy, policy, hosts, selected, desktops = [], selectedDesktops = [], selectedExchanges = [], onSelectExchanges, onSelectDesktops, onDesktops, enabled, loading, working, error, mustRefresh, updated, onClose, onRefresh, onSave, onEnabled, onSelect, onAgent, onDirectory }: Props) {
  const [query, setQuery] = useState('')
  useEffect(() => { if (!open) setQuery('') }, [open])
  const inactive = loading || !!working || !policy || mustRefresh
  const matching = hosts.filter(host => host.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const selectedIDs = new Set(selected)
  const matchingIDs = new Set(matching.map(host => host.id))
  const unselectedMatches = matching.filter(host => !selectedIDs.has(host.id))
  const hasSelectedMatches = matching.some(host => selectedIDs.has(host.id))
  const allMatchesSelected = matching.length > 0 && unselectedMatches.length === 0
  const canSelectMatches = selected.length + unselectedMatches.length <= 256
  const clearMatches = allMatchesSelected || !canSelectMatches
  const bulkLabel = !canSelectMatches && hasSelectedMatches
    ? (query.trim() ? copy.clearHostResults : copy.clearHosts)
    : (query.trim() ? copy.selectHostResults : copy.selectHosts)
  const directories = policy?.directories ?? []
  const savedHosts = new Set(policy?.hosts.map(host => host.id).filter(id => hosts.some(host => host.id === id)))
  const dirty = !!policy && (enabled !== policy.enabled || savedHosts.size !== selected.length || selected.some(id => !savedHosts.has(id)))
  const label = (icon: ReactNode, text: string, count?: number) => <span className={styles['tab-label']}>{icon}{text}{count !== undefined ? <span className={styles.count}>{count}</span> : null}</span>

  const availableDesktops = desktops.filter(profile => savedHosts.has(profile.host_id))
  const desktopPanel = <section className={styles.panel} aria-label={copy.desktopAccess}>
    <p className={styles.hint}>{copy.desktopAccessHint}</p>
    <p className={styles.hint}>{copy.desktopCredentialHint}</p>
    <p className={styles.hint}>{copy.desktopExchangeHint}</p>
    {availableDesktops.length === 0 ? <WorkspaceEmptyState icon={<Monitor size={18} />} title={copy.noConnections} description={copy.desktopAccessHint} /> : <div className={styles['host-list']}>
      {availableDesktops.map(profile => <div key={profile.id}><Checkbox className={styles['host-choice']} disabled={inactive || dirty} checked={selectedDesktops.includes(profile.id)} onChange={event => onSelectDesktops?.(event.target.checked ? [...selectedDesktops, profile.id] : selectedDesktops.filter(id => id !== profile.id))}>
        <span className={styles['host-name']}><Monitor size={16} /><span>{hosts.find(host => host.id === profile.host_id)?.name} · {profile.name}</span><Tag>{profile.protocol.toUpperCase()}</Tag></span>
      </Checkbox>{profile.protocol === 'rdp' ? <Checkbox className={styles['host-choice']} disabled={inactive || dirty || !selectedDesktops.includes(profile.id)} checked={selectedExchanges.includes(profile.id)} onChange={event => onSelectExchanges?.(event.target.checked ? [...selectedExchanges, profile.id] : selectedExchanges.filter(id => id !== profile.id))}>{copy.desktopExchange}</Checkbox> : null}</div>)}
    </div>}
    <Button type="primary" disabled={inactive || dirty} loading={working === 'desktop'} onClick={onDesktops}>{copy.saveDesktops}</Button>
  </section>

  const hostPanel = <section className={styles.panel} aria-label={copy.hostConnections}>
    <p className={styles.hint}>{copy.hostsHint}</p>
    <div className={styles.toolbar}>
      <Input aria-label={copy.searchHosts} placeholder={copy.searchHosts} prefix={<Search size={15} aria-hidden="true" />} allowClear value={query} disabled={inactive} onChange={event => setQuery(event.target.value)} />
      <div className={styles['bulk-selection']}>
        <Checkbox className={styles['bulk-toggle']} checked={allMatchesSelected} indeterminate={hasSelectedMatches && !allMatchesSelected} disabled={inactive || matching.length === 0 || (!canSelectMatches && !hasSelectedMatches)} onChange={() => {
          // 超出上限时仍允许批量取消，避免半选状态无法清空。
          onSelect(clearMatches ? selected.filter(id => !matchingIDs.has(id)) : [...selected, ...unselectedMatches.map(host => host.id)])
        }}>{bulkLabel}</Checkbox>
        <span className={styles.selection}>{copy.selectedHosts} <strong>{selected.length}</strong><span className={styles.total}> / {hosts.length}</span></span>
      </div>
    </div>
    {hosts.length === 0 ? <WorkspaceEmptyState icon={<Server size={18} />} title={copy.noConnections} description={copy.noHostsHint} /> : matching.length === 0 ? <WorkspaceEmptyState icon={<Search size={18} />} title={copy.noMatchingHosts} /> : <div className={styles['host-list']}>
      {matching.map(host => {
        const checked = selectedIDs.has(host.id)
        return <Checkbox key={host.id} className={`${styles['host-choice']} ${checked ? styles.selected : ''}`} checked={checked} disabled={inactive || (!checked && selected.length >= 256)} onChange={event => onSelect(event.target.checked ? [...selected, host.id] : selected.filter(id => id !== host.id))}>
          <span className={styles['host-name']}><Server size={16} aria-hidden="true" /><span>{host.name}</span></span>
        </Checkbox>
      })}
    </div>}
    {selected.length >= 256 || !canSelectMatches ? <p className={styles.hint}>{copy.hostLimit}</p> : null}
  </section>

  const directoryPanel = <section className={styles.panel} aria-label={copy.allowedFolders}>
    <div className={styles['panel-heading']}><p className={styles.hint}>{copy.folderHint}</p><span className={styles['immediate-note']}>{copy.immediate}</span></div>
    <div className={styles['folder-actions']}>
      <Button icon={<FolderPlus size={15} />} disabled={inactive || directories.length >= 32} onClick={() => onDirectory(false)}>{copy.addRead}</Button>
      <Button icon={<FolderPlus size={15} />} disabled={inactive || directories.length >= 32} onClick={() => onDirectory(true)}>{copy.addWrite}</Button>
    </div>
    {directories.length === 0 ? <WorkspaceEmptyState icon={<Folder size={18} />} title={copy.noAllowedFolders} description={copy.noAllowedFoldersHint} /> : <ul className={styles['directory-list']}>
      {directories.map(root => <li key={root.id} className={styles.directory}>
        <span className={styles['directory-icon']}><Folder size={19} aria-hidden="true" /></span>
        <div className={styles['directory-copy']}><strong>{root.name}</strong><span>{root.path}</span></div>
        <Tag className={styles.permission} color={root.write ? 'blue' : undefined}>{root.write ? copy.readWrite : copy.readOnly}</Tag>
        <Popconfirm {...termousPopconfirmProps} title={copy.revokeFolderTitle} description={copy.revokeFolderHint} okText={copy.revokeFolder} cancelText={copy.cancel} okButtonProps={{ danger: true }} disabled={inactive} onConfirm={() => onDirectory(false, root.id)}>
          <Button type="text" className={styles.revoke} disabled={inactive} icon={<Trash2 size={15} />} aria-label={`${copy.revokeFolder} · ${root.name}`} />
        </Popconfirm>
      </li>)}
    </ul>}
    {directories.length >= 32 ? <p className={styles.hint}>{copy.folderLimit}</p> : null}
  </section>

  const agentPanel = <section className={styles.panel} aria-label={copy.agent}>
    <div className={styles['agent-control']}>
      <span className={styles['agent-icon']}><Bot size={22} aria-hidden="true" /></span>
      <div><h3>{copy.agentPermission}</h3><span className={styles['immediate-note']}>{copy.immediate}</span></div>
      <Switch checked={policy?.agent_enabled === true} disabled={inactive} loading={working === 'agent'} onChange={onAgent} aria-label={copy.agentPermission} />
    </div>
    <dl className={styles.scope}>
      <div><dt>{copy.agentScope}</dt><dd>{copy.agentScopeHint}</dd></div>
      <div><dt>{copy.agentTools}</dt><dd>{copy.agentToolsHint}</dd></div>
    </dl>
  </section>

  return <Modal open={open} centered width={760} rootClassName={modalSurfaceStyles.root} className={styles.modal} destroyOnHidden closable={!working} mask={{ closable: !working }} keyboard={!working} onCancel={onClose}
    title={<div className={styles.title}><span className={styles['title-icon']}><Settings2 size={19} aria-hidden="true" /></span><div><strong>{copy.configure}</strong><p><ShieldCheck size={13} aria-hidden="true" />{copy.accessHint}</p></div></div>}
    footer={<div className={styles.footer}>
      <span className={`${styles['footer-hint']} ${dirty ? styles.pending : ''}`}>{dirty ? copy.pendingHosts : copy.hostSaveHint}</span>
      <div className={styles['footer-actions']}>{policy && error ? <Button disabled={!!working} onClick={onRefresh}>{copy.refresh}</Button> : null}<Button disabled={!!working} onClick={onClose}>{copy.close}</Button><Button type="primary" loading={working === 'save'} disabled={inactive} onClick={onSave}>{copy.saveHosts}</Button></div>
    </div>}><FeedbackMessageScope active={open}>
    <div className={styles.body}>
      {error && !loading ? <FeedbackMessage type="warning" title={policy ? remoteErrorText(copy, error) : copy.accessReadFailed} description={!policy ? remoteErrorText(copy, error) : undefined} /> : null}
      {loading ? <div className={styles.loading} role="status" aria-label={copy.accessLoading}><Skeleton active paragraph={{ rows: 5 }} /></div> : !policy ? <WorkspaceEmptyState icon={<Settings2 size={18} />} title={copy.configure} action={<Button onClick={onRefresh}>{copy.refresh}</Button>} /> : <>
        <div className={styles['remote-control']}><Monitor size={20} aria-hidden="true" /><div><h3>{copy.hostSettings}</h3><p>{copy.accessSwitchHint}</p></div><Switch checked={enabled} disabled={inactive} onChange={onEnabled} aria-label={copy.hostSettings} /></div>
        <Tabs className={styles.tabs} defaultActiveKey="hosts" animated={false} items={[
          { key: 'hosts', label: label(<Server size={15} aria-hidden="true" />, copy.hostConnections, selected.length), children: hostPanel },
          { key: 'folders', label: label(<Folder size={15} aria-hidden="true" />, copy.allowedFolders, directories.length), children: directoryPanel },
          ...(onDesktops ? [{ key: 'desktops', label: label(<Monitor size={15} />, copy.desktopAccess, selectedDesktops.length), children: desktopPanel }] : []),
          { key: 'agent', label: label(<Bot size={15} aria-hidden="true" />, copy.agent), children: agentPanel },
        ]} />
        {updated && !error ? <FeedbackMessage type="success" title={copy.accessUpdated} /> : null}
      </>}
    </div>
  </FeedbackMessageScope></Modal>
}
