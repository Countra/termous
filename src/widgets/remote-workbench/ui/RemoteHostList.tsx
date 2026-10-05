import { Button, Empty, Tag, Tooltip } from 'antd'
import { Folder, Server, Terminal } from 'lucide-react'
import type { Host } from '#entities/remote-control'
import type { RemoteCopy } from '#features/remote-control'
import styles from './RemoteWorkbench.module.scss'

interface Props {
  hosts: Host[]
  filter: string
  disabled: boolean
  copy: RemoteCopy
  create(id: string, kind: 'ssh' | 'files'): void
}

export function RemoteHostList({ hosts, filter, disabled, copy, create }: Props) {
  const query = filter.trim().toLowerCase()
  const visible = hosts.map(host => ({
    ...host,
    connections: host.connections.filter(profile =>
      (profile.kind === 'ssh' || profile.kind === 'files') &&
      `${host.name} ${profile.name} ${profile.engine}`.toLowerCase().includes(query)),
  })).filter(host => !query || host.connections.length > 0)
  return <div className={styles.resources}>
    {!visible.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={copy.emptyHint} /> : null}
    {visible.map(host => <section className={styles.profile} key={host.id} aria-label={host.name}>
      <div className={styles['profile-name']}><Server size={16} /><strong title={host.name}>{host.name}</strong></div>
      {host.connections.map(profile => {
        const kind = profile.kind === 'ssh' ? 'ssh' : 'files'
        const action = kind === 'ssh' ? copy.newTerminal : copy.newFiles
        return <Tooltip key={`${kind}:${profile.id}`} title={profile.available ? action : copy.changedProfile}>
          <span><Button block className={styles.connection} disabled={disabled || !profile.available}
            aria-label={`${action} · ${host.name} · ${profile.name}`}
            icon={kind === 'ssh' ? <Terminal size={15} /> : <Folder size={15} />}
            onClick={() => create(profile.id, kind)}>
            <span className={styles['connection-name']}>{profile.name}</span>
            <Tag>{kind === 'ssh' ? 'SSH' : profile.engine.toUpperCase()}</Tag>
          </Button></span>
        </Tooltip>
      })}
    </section>)}
  </div>
}
