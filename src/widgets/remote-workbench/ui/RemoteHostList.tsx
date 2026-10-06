import { useId, useState } from 'react'
import { Button, Empty, Tag, Tooltip } from 'antd'
import { ArrowUpRight, ChevronDown, ChevronRight, Folder, Server, Terminal } from 'lucide-react'
import type { Host } from '#entities/remote-control'
import type { RemoteCopy } from '#features/remote-control'
import styles from './RemoteResources.module.scss'

interface Props {
  hosts: Host[]
  filter: string
  disabled: boolean
  copy: RemoteCopy
  create(id: string, kind: 'ssh' | 'files'): void
}

export function RemoteHostList({ hosts, filter, disabled, copy, create }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const listId = useId()
  const query = filter.trim().toLowerCase()
  const visible = hosts.map(host => ({
    ...host,
    connections: host.connections.filter(profile =>
      (profile.kind === 'ssh' || profile.kind === 'files') &&
      `${host.name} ${profile.name} ${profile.kind} ${profile.engine} ${profile.kind === 'ssh' ? copy.terminal : copy.files}`.toLowerCase().includes(query)),
  })).filter(host => !query || host.connections.length > 0)
  return <div className={styles.resources}>
    {!visible.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? copy.noResults : copy.noConnections} /> : null}
    {visible.map(host => <section className={styles.profile} key={host.id} aria-label={host.name}>
      <button className={styles['profile-name']} aria-label={host.name} aria-controls={`${listId}-${host.id}`} aria-expanded={!!query || !collapsed.has(host.id)} onClick={() => setCollapsed(previous => {
        const next = new Set(previous)
        if (next.has(host.id)) next.delete(host.id); else next.add(host.id)
        return next
      })}><span className={styles['host-icon']}><Server size={15} /></span><strong title={host.name}>{host.name}</strong><small>{host.connections.length}</small>{!query && collapsed.has(host.id) ? <ChevronRight className={styles['host-arrow']} size={13} /> : <ChevronDown className={styles['host-arrow']} size={13} />}</button>
      <div id={`${listId}-${host.id}`} className={styles['host-connections']} hidden={!query && collapsed.has(host.id)}>{host.connections.map(profile => {
        const kind = profile.kind === 'ssh' ? 'ssh' : 'files'
        const action = kind === 'ssh' ? copy.newTerminal : copy.newFiles
        return <Tooltip key={`${kind}:${profile.id}`} title={profile.available ? action : copy.changedProfile}>
          <span><Button block className={styles.connection} disabled={disabled || !profile.available}
            aria-label={`${action} · ${host.name} · ${profile.name}`}
            icon={<span className={`${styles['connection-icon']} ${kind === 'files' ? styles['files-icon'] : ''}`}>{kind === 'ssh' ? <Terminal size={15} /> : <Folder size={15} />}</span>}
            onClick={() => create(profile.id, kind)}>
            <span className={styles['connection-name']}>{profile.name}</span>
            <Tag>{kind === 'ssh' ? 'SSH' : profile.engine.toUpperCase()}</Tag>
            <ArrowUpRight className={styles['connection-arrow']} size={12} />
          </Button></span>
        </Tooltip>
      })}</div>
    </section>)}
  </div>
}
