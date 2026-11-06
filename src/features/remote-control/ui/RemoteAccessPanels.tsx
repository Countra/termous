import { useState } from 'react'
import { Button, Checkbox, Input, Popconfirm, Switch, Tag } from 'antd'
import { ArrowLeftRight, Bot, Folder, FolderPlus, Monitor, Search, Server, Trash2 } from 'lucide-react'
import type { RemotePolicy } from '#common/contracts'
import { termousPopconfirmProps, WorkspaceEmptyState } from '#shared/ui'
import type { RemoteCopy } from '../model/copy'
import styles from './RemoteAccessPanels.module.scss'
import { RemoteAccessHelp } from './RemoteAccessHelp'

type Host = { id: string; name: string }
type Desktop = { id: string; host_id: string; name: string; protocol: string }

export function RemoteHostAccessPanel({ copy, hosts, selected, disabled, onSelect }: {
  copy: RemoteCopy; hosts: Host[]; selected: string[]; disabled: boolean; onSelect(value: string[]): void
}) {
  const [query, setQuery] = useState('')
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

  return <section className={styles.panel} aria-label={copy.hostConnections}>
    <header className={styles.heading}>
      <div>
        <div className={styles['heading-title']}>
          <h3>{copy.hostConnections}</h3>
          <RemoteAccessHelp label={`${copy.hostConnections} · ${copy.permissionDetails}`}><p>{copy.hostsHint}</p></RemoteAccessHelp>
        </div>
        <p>{copy.hostsSummary}</p>
      </div>
      <span className={styles.note}>{copy.saveRequired}</span>
    </header>
    <Input aria-label={copy.searchHosts} placeholder={copy.searchHosts} prefix={<Search size={15} aria-hidden="true" />} allowClear value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} />
    <div className={styles.selection}>
      <Checkbox checked={allMatchesSelected} indeterminate={hasSelectedMatches && !allMatchesSelected} disabled={disabled || matching.length === 0 || (!canSelectMatches && !hasSelectedMatches)} onChange={() => {
        // 超出上限时仍允许批量取消，保留筛选之外的选择。
        onSelect(clearMatches ? selected.filter(id => !matchingIDs.has(id)) : [...selected, ...unselectedMatches.map(host => host.id)])
      }}>{bulkLabel}</Checkbox>
      <span>{copy.selectedHosts} <strong>{selected.length}</strong><span> / {hosts.length}</span></span>
    </div>
    {hosts.length === 0 ? <WorkspaceEmptyState icon={<Server size={18} />} title={copy.noConnections} description={copy.noHostsHint} /> : matching.length === 0 ? <WorkspaceEmptyState icon={<Search size={18} />} title={copy.noMatchingHosts} /> : <div className={styles['host-list']}>
      {matching.map(host => {
        const checked = selectedIDs.has(host.id)
        return <Checkbox key={host.id} className={styles.choice} checked={checked} disabled={disabled || (!checked && selected.length >= 256)} onChange={event => onSelect(event.target.checked ? [...selected, host.id] : selected.filter(id => id !== host.id))}>
          <span className={styles['choice-name']}><span className={styles['resource-icon']}><Server size={16} aria-hidden="true" /></span><span className={styles['resource-copy']}>{host.name}</span></span>
        </Checkbox>
      })}
    </div>}
    {selected.length >= 256 || !canSelectMatches ? <p className={styles.hint}>{copy.hostLimit}</p> : null}
  </section>
}

export function RemoteDesktopAccessPanel({ copy, hosts, desktops, selected, exchanges, disabled, pending, working, onSelect, onExchanges, onSave }: {
  copy: RemoteCopy; hosts: Host[]; desktops: Desktop[]; selected: string[]; exchanges: string[]
  disabled: boolean; pending: boolean; working: boolean
  onSelect?(value: string[]): void; onExchanges?(value: string[]): void; onSave(): void
}) {
  return <section className={styles.panel} aria-label={copy.desktopAccess}>
    <header className={styles.heading}>
      <div>
        <div className={styles['heading-title']}>
          <h3>{copy.desktopAccess}</h3>
          <RemoteAccessHelp label={`${copy.desktopAccess} · ${copy.permissionDetails}`}>
            <dl className={styles['protocol-help']}>
              <div><dt>VNC</dt><dd>{copy.vncCredentialHint}</dd></div>
              <div><dt>RDP</dt><dd>{copy.rdpCredentialHint}</dd></div>
            </dl>
          </RemoteAccessHelp>
        </div>
        <p>{copy.desktopSummary}</p>
      </div>
      <span className={styles.note}>{copy.saveRequired}</span>
    </header>
    {pending ? <p className={styles.pending}>{copy.desktopPending}</p> : null}
    {desktops.length === 0 ? <WorkspaceEmptyState icon={<Monitor size={18} />} title={copy.noConnections} description={copy.desktopEmptyHint} /> : <div className={styles['desktop-list']}>
      {desktops.map(profile => <div className={styles['desktop-card']} key={profile.id}>
        <Checkbox className={styles.choice} disabled={disabled} checked={selected.includes(profile.id)}
          onChange={event => onSelect?.(event.target.checked ? [...selected, profile.id] : selected.filter(id => id !== profile.id))}>
          <span className={styles['choice-name']}>
            <span className={styles['resource-icon']}><Monitor size={17} aria-hidden="true" /></span>
            <span className={styles['resource-copy']}>
              <strong>{profile.name}</strong>
              <small>{hosts.find(host => host.id === profile.host_id)?.name}</small>
            </span>
            <Tag>{profile.protocol.toUpperCase()}</Tag>
          </span>
        </Checkbox>
        {profile.protocol === 'rdp' ? <div className={styles.exchange}>
          <ArrowLeftRight size={14} aria-hidden="true" />
          <Checkbox disabled={disabled || !selected.includes(profile.id)} checked={exchanges.includes(profile.id)}
            onChange={event => onExchanges?.(event.target.checked ? [...exchanges, profile.id] : exchanges.filter(id => id !== profile.id))}>
            {copy.desktopExchange}
          </Checkbox>
          <RemoteAccessHelp label={`${profile.name} · ${copy.desktopExchange}`}><p>{copy.desktopExchangeHint}</p></RemoteAccessHelp>
        </div> : null}
      </div>)}
    </div>}
    <div className={styles.actions}><Button type="primary" disabled={disabled} loading={working} onClick={onSave}>{copy.saveDesktops}</Button></div>
  </section>
}

export function RemoteFolderAccessPanel({ copy, directories, full, disabled, onDirectory }: {
  copy: RemoteCopy; directories: NonNullable<RemotePolicy['directories']>; full: boolean; disabled: boolean; onDirectory(write: boolean, id?: string): void
}) {
  return <section className={styles.panel} aria-label={copy.allowedFolders}>
    <header className={styles.heading}><h3>{copy.allowedFolders}</h3><span className={styles.note}>{copy.immediate}</span></header>
    <div className={styles['folder-actions']}>
      {!full ? <Button icon={<FolderPlus size={15} />} disabled={disabled || directories.length >= 32} onClick={() => onDirectory(false)}>{copy.addRead}</Button> : null}
      <Button icon={<FolderPlus size={15} />} disabled={disabled || directories.length >= 32} onClick={() => onDirectory(true)}>{copy.addWrite}</Button>
    </div>
    {directories.length === 0 ? <WorkspaceEmptyState icon={<Folder size={18} />} title={copy.noAllowedFolders} description={copy.noAllowedFoldersHint} /> : <ul className={styles['directory-list']}>
      {directories.map(root => <li key={root.id} className={styles.directory}>
        <span className={styles['resource-icon']}><Folder size={19} aria-hidden="true" /></span>
        <div className={styles['directory-copy']}><strong>{root.name}</strong><span>{root.path}</span></div>
        <Tag color={full || root.write ? 'blue' : undefined}>{full || root.write ? copy.readWrite : copy.readOnly}</Tag>
        <Popconfirm {...termousPopconfirmProps} title={copy.revokeFolderTitle} description={copy.revokeFolderHint}
          okText={copy.revokeFolder} cancelText={copy.cancel} okButtonProps={{ danger: true }}
          disabled={disabled} onConfirm={() => onDirectory(false, root.id)}>
          <Button type="text" className={styles.revoke} disabled={disabled} icon={<Trash2 size={15} />} aria-label={`${copy.revokeFolder} · ${root.name}`} />
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
    <header className={styles.heading}><h3>{copy.agent}</h3><span className={styles.note}>{copy.immediate}</span></header>
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
