import { useState } from 'react'
import { Button, Checkbox, Input, Popconfirm, Spin, Switch, Tag } from 'antd'
import { ArrowLeftRight, Bot, Folder, FolderPlus, Monitor, Search, Server, Trash2 } from 'lucide-react'
import type { RemotePolicy, RemotePolicyChange, RemotePolicyResource } from '#common/contracts'
import { termousPopconfirmProps, WorkspaceEmptyState } from '#shared/ui'
import type { RemoteCopy } from '../model/copy'
import styles from './RemoteAccessPanels.module.scss'
import { RemoteAccessHelp } from './RemoteAccessHelp'

interface SelectionProps {
  copy: RemoteCopy; selected: string[]; disabled: boolean; full: boolean; pending: ReadonlySet<string>
  onChange(change: RemotePolicyChange): void
}

function ResourceStatus({ resource, copy, busy, selected, disabled, reauthorize }: {
  resource: RemotePolicyResource; copy: RemoteCopy; busy: boolean; selected: boolean; disabled: boolean; reauthorize(): void
}) {
  if (busy) return <Spin size="small" aria-label={copy.updating} />
  if (resource.status === 'unavailable') return <Tag>{copy.resourceUnavailable}</Tag>
  if (!selected || resource.status !== 'changed') return null
  return <span className={styles['resource-action']}><Tag color="gold">{copy.reauthorizationRequired}</Tag><Button size="small" type="text" disabled={disabled} onClick={reauthorize} aria-label={`${copy.reauthorize} · ${resource.name}`}>{copy.reauthorize}</Button></span>
}

export function RemoteHostAccessPanel({ copy, hosts, selected, disabled, full, pending, onChange }: SelectionProps & { hosts: RemotePolicyResource[] }) {
  const [query, setQuery] = useState('')
  const matching = hosts.filter(host => host.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const selectedIDs = new Set(selected)
  const unselected = matching.filter(h => !selectedIDs.has(h.id) && h.status !== 'unavailable')
  const checked = matching.filter(h => selectedIDs.has(h.id))
  const all = checked.length > 0 && unselected.length === 0
  const canSelect = selected.length + unselected.length <= 256
  const bulkBusy = matching.some(h => pending.has(`host:${h.id}`))
  const clear = all || !canSelect
  return <section className={styles.panel} aria-label={copy.hostConnections}>
    <header className={styles.heading}><div><div className={styles['heading-title']}><h3>{copy.hostConnections}</h3><RemoteAccessHelp label={`${copy.hostConnections} · ${copy.permissionDetails}`}><p>{copy.hostsHint}</p></RemoteAccessHelp></div><p>{copy.hostsSummary}</p></div></header>
    <Input aria-label={copy.searchHosts} placeholder={copy.searchHosts} prefix={<Search size={15} aria-hidden="true" />} allowClear value={query} onChange={event => setQuery(event.target.value)} />
    <div className={styles.selection}>
      <Checkbox checked={all} indeterminate={checked.length > 0 && !all} disabled={disabled || bulkBusy || !checked.length && (!unselected.length || !canSelect)}
        onChange={() => onChange(clear ? { kind: 'hosts', remove: checked.map(h => h.id) } : { kind: 'hosts', add: unselected.map(h => h.id) })}>
        {clear ? query.trim() ? copy.clearHostResults : copy.clearHosts : query.trim() ? copy.selectHostResults : copy.selectHosts}
      </Checkbox>
      <span>{copy.selectedHosts} <strong>{selected.length}</strong><span> / {hosts.length}</span></span>
    </div>
    {hosts.length === 0 ? <WorkspaceEmptyState icon={<Server size={18} />} title={copy.noConnections} description={copy.noHostsHint} /> : !matching.length ? <WorkspaceEmptyState icon={<Search size={18} />} title={copy.noMatchingHosts} /> : <div className={styles['host-list']}>
      {matching.map(host => {
        const selected = selectedIDs.has(host.id)
        const busy = pending.has(`host:${host.id}`)
        return <div className={styles['resource-row']} key={host.id} aria-busy={busy}>
          <Checkbox className={styles.choice} checked={selected} disabled={disabled || busy || !selected && (host.status === 'unavailable' || selectedIDs.size >= 256)}
            onChange={event => onChange(event.target.checked ? { kind: 'hosts', add: [host.id] } : { kind: 'hosts', remove: [host.id] })}>
            <span className={styles['choice-name']}><span className={styles['resource-icon']}><Server size={16} aria-hidden="true" /></span><span className={styles['resource-copy']}>{host.name}</span></span>
          </Checkbox>
          <ResourceStatus resource={host} copy={copy} busy={busy} selected={selected && !full} disabled={disabled} reauthorize={() => onChange({ kind: 'hosts', reauthorize: [host.id] })} />
        </div>
      })}
    </div>}
    {selected.length >= 256 || !canSelect ? <p className={styles.hint}>{copy.hostLimit}</p> : null}
  </section>
}

export function RemoteDesktopAccessPanel({ copy, hosts, desktops, selected, exchanges, disabled, full, pending, onChange }: SelectionProps & {
  hosts: RemotePolicyResource[]; desktops: RemotePolicyResource[]; exchanges: string[]
}) {
  return <section className={styles.panel} aria-label={copy.desktopAccess}>
    <header className={styles.heading}><div><div className={styles['heading-title']}><h3>{copy.desktopAccess}</h3>
      <RemoteAccessHelp label={`${copy.desktopAccess} · ${copy.permissionDetails}`}><dl className={styles['protocol-help']}><div><dt>VNC</dt><dd>{copy.vncCredentialHint}</dd></div><div><dt>RDP</dt><dd>{copy.rdpCredentialHint}</dd></div></dl></RemoteAccessHelp>
    </div><p>{copy.desktopSummary}</p></div></header>
    {desktops.length === 0 ? <WorkspaceEmptyState icon={<Monitor size={18} />} title={copy.noConnections} description={copy.desktopEmptyHint} /> : <div className={styles['desktop-list']}>
      {desktops.map(profile => {
        const checked = selected.includes(profile.id)
        const busy = pending.has(`desktop:${profile.id}`)
        return <div className={styles['desktop-card']} key={profile.id} aria-busy={busy}>
          <div className={styles['resource-row']}>
            <Checkbox className={styles.choice} disabled={disabled || busy || !checked && (profile.status === 'unavailable' || selected.length >= 256)} checked={checked}
              onChange={event => onChange(event.target.checked ? { kind: 'desktops', add: [profile.id] } : { kind: 'desktops', remove: [profile.id] })}>
              <span className={styles['choice-name']}><span className={styles['resource-icon']}><Monitor size={17} aria-hidden="true" /></span>
                <span className={styles['resource-copy']}><strong>{profile.name}</strong><small>{hosts.find(h => h.id === profile.host_id)?.name}</small></span>
                {profile.protocol ? <Tag>{profile.protocol.toUpperCase()}</Tag> : null}
              </span>
            </Checkbox>
            <ResourceStatus resource={profile} copy={copy} busy={busy} selected={checked && !full} disabled={disabled} reauthorize={() => onChange({ kind: 'desktops', reauthorize: [profile.id] })} />
          </div>
          {profile.protocol === 'rdp' ? <div className={styles.exchange}><ArrowLeftRight size={14} aria-hidden="true" />
            <Checkbox disabled={disabled || busy || !checked || !exchanges.includes(profile.id) && profile.status !== 'available'} checked={exchanges.includes(profile.id)}
              onChange={event => onChange(event.target.checked ? { kind: 'exchange', add: [profile.id] } : { kind: 'exchange', remove: [profile.id] })}>{copy.desktopExchange}</Checkbox>
            <RemoteAccessHelp label={`${profile.name} · ${copy.desktopExchange}`}><p>{copy.desktopExchangeHint}</p></RemoteAccessHelp>
          </div> : null}
        </div>
      })}
    </div>}
  </section>
}

export function RemoteFolderAccessPanel({ copy, directories, full, disabled, pending, picking, onDirectory }: {
  copy: RemoteCopy; directories: NonNullable<RemotePolicy['directories']>; full: boolean; disabled: boolean; pending: ReadonlySet<string>; picking: boolean; onDirectory(write: boolean, id?: string): void
}) {
  return <section className={styles.panel} aria-label={copy.allowedFolders}>
    <header className={styles.heading}><h3>{copy.allowedFolders}</h3></header>
    <div className={styles['folder-actions']}>
      {!full ? <Button icon={<FolderPlus size={15} />} disabled={disabled || picking || pending.has('directory_add') || directories.length >= 32} onClick={() => onDirectory(false)}>{copy.addRead}</Button> : null}
      <Button icon={<FolderPlus size={15} />} disabled={disabled || picking || pending.has('directory_add') || directories.length >= 32} onClick={() => onDirectory(true)}>{copy.addWrite}</Button>
    </div>
    {directories.length === 0 ? <WorkspaceEmptyState icon={<Folder size={18} />} title={copy.noAllowedFolders} description={copy.noAllowedFoldersHint} /> : <ul className={styles['directory-list']}>
      {directories.map(root => <li key={root.id} className={styles.directory}>
        <span className={styles['resource-icon']}><Folder size={19} aria-hidden="true" /></span>
        <div className={styles['directory-copy']}><strong>{root.name}</strong><span>{root.path}</span></div>
        <Tag color={full || root.write ? 'blue' : undefined}>{full || root.write ? copy.readWrite : copy.readOnly}</Tag>
        <Popconfirm {...termousPopconfirmProps} title={copy.revokeFolderTitle} description={copy.revokeFolderHint}
          okText={copy.revokeFolder} cancelText={copy.cancel} okButtonProps={{ danger: true }}
          disabled={disabled || pending.has(`directory:${root.id}`)} onConfirm={() => onDirectory(false, root.id)}>
          <Button type="text" className={styles.revoke} loading={pending.has(`directory:${root.id}`)} disabled={disabled || pending.has(`directory:${root.id}`)} icon={<Trash2 size={15} />} aria-label={`${copy.revokeFolder} · ${root.name}`} />
        </Popconfirm>
      </li>)}
    </ul>}
    {directories.length >= 32 ? <p className={styles.hint}>{copy.folderLimit}</p> : null}
  </section>
}

export function RemoteAgentAccessPanel({ copy, enabled, disabled, working, onChange }: {
  copy: RemoteCopy; enabled: boolean; disabled: boolean; working: boolean; onChange(value: boolean): void
}) {
  return <section className={styles.panel} aria-label={copy.agent}>
    <header className={styles.heading}><h3>{copy.agent}</h3></header>
    <div className={styles['permission-row']}>
      <span className={styles['resource-icon']}><Bot size={20} aria-hidden="true" /></span>
      <div>
        <div className={styles['permission-title']}>
          <h4>{copy.agentPermission}</h4>
          <RemoteAccessHelp label={`${copy.agent} · ${copy.permissionDetails}`}><p>{copy.agentToolsHint}</p></RemoteAccessHelp>
        </div>
        <p>{copy.agentScopeHint}</p>
      </div>
      <Switch checked={enabled} disabled={disabled} loading={working} onChange={onChange} aria-label={copy.agentPermission} />
    </div>
  </section>
}
