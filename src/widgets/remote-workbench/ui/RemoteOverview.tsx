import { useState } from 'react'
import { Button } from 'antd'
import { ArrowRight, Bot, Folder, Monitor, Search, ShieldCheck, Terminal } from 'lucide-react'
import type { Inventory, Session } from '#entities/remote-control'
import type { RemoteCopy } from '#features/remote-control'
import styles from './RemoteOverview.module.scss'

interface Props {
  inventory?: Inventory
  copy: RemoteCopy
  deviceName: string
  filter: string
  disabled: boolean
  name(session: Session): string
  open(session: Session): void
  create(id: string, kind: 'ssh' | 'files' | 'desktop'): void
  showResources(): void
  openAgent?: () => void
}

export function RemoteOverview({ inventory, copy, deviceName, filter, disabled, name, open, create, showResources, openAgent }: Props) {
  const [kind, setKind] = useState<'ssh' | 'files' | 'desktop'>('ssh')
  const query = filter.trim().toLowerCase()
  const connections = (inventory?.hosts ?? []).flatMap(host => host.connections
    .filter(profile => (profile.kind === 'ssh' || profile.kind === 'files' || profile.kind === 'desktop') &&
      `${host.name} ${profile.name} ${profile.kind} ${profile.engine} ${profile.kind === 'desktop' ? copy.desktop : profile.kind === 'ssh' ? copy.terminal : copy.files}`.toLowerCase().includes(query))
    .map(profile => ({ host, profile })))
  const visible = connections.filter(item => item.profile.kind === kind)
  const sessions = (inventory?.sessions ?? []).filter(session =>
    `${name(session)} ${session.kind} ${session.engine} ${session.kind === 'desktop' ? copy.desktop : session.kind === 'ssh' ? copy.terminal : copy.files} ${inventory?.hosts.find(host => host.id === session.hostId)?.name ?? ''}`.toLowerCase().includes(query))

  return <div className={styles.overview}>
    <div className={styles.content}>
      <header className={styles.intro}>
        <div className={styles.device}><Monitor size={18} /><span>{copy.controlledComputer}</span><strong title={deviceName}>{deviceName}</strong></div>
        <h1>{copy.workspaceTitle}</h1>
        <p>{copy.workspaceHint}</p>
      </header>

      {sessions.length > 0 ? <section className={styles.section} aria-label={copy.existingSessions}>
        <div className={styles.heading}><h2>{copy.existingSessions}</h2><span>{sessions.length}</span></div>
        <div className={styles['session-list']}>
          {sessions.slice(0, 4).map(session => <button key={session.id} className={styles.session} disabled={disabled}
            aria-label={`${copy.openSession} · ${name(session)}`} onClick={() => open(session)}>
            <span className={styles['resource-icon']}>{session.kind === 'desktop' ? <Monitor size={18} /> : session.kind === 'ssh' ? <Terminal size={18} /> : <Folder size={18} />}</span>
            <span className={styles['resource-name']}><strong>{name(session)}</strong><small>{session.kind === 'desktop' ? copy.desktop : session.kind === 'ssh' ? copy.terminal : copy.files}<span className={`${styles.dot} ${['connected', 'ready', 'streaming', 'reattach_wait'].includes(session.state) ? styles.online : ''}`} />{['connected', 'ready', 'streaming', 'reattach_wait'].includes(session.state) ? copy.connected : ['connecting', 'reconnecting'].includes(session.state) ? copy.connecting : copy.disconnected}</small></span>
            <ArrowRight size={15} className={styles.arrow} />
          </button>)}
        </div>
      </section> : null}

      <section className={styles.section} aria-label={copy.startConnection}>
        <div className={styles.heading}>
          <h2>{copy.startConnection}</h2>
          <div className={styles.switcher} role="group" aria-label={copy.startConnection}>
            <button aria-label={copy.terminal} aria-pressed={kind === 'ssh'} onClick={() => setKind('ssh')}><Terminal size={14} />{copy.terminal}<span aria-hidden="true">{connections.filter(item => item.profile.kind === 'ssh').length}</span></button>
            <button aria-label={copy.desktop} aria-pressed={kind === 'desktop'} onClick={() => setKind('desktop')}><Monitor size={14} />{copy.desktop}<span aria-hidden="true">{connections.filter(item => item.profile.kind === 'desktop').length}</span></button>
            <button aria-label={copy.files} aria-pressed={kind === 'files'} onClick={() => setKind('files')}><Folder size={14} />{copy.files}<span aria-hidden="true">{connections.filter(item => item.profile.kind === 'files').length}</span></button>
          </div>
        </div>
        {visible.length ? <div className={styles['connection-list']}>
          {visible.slice(0, 6).map(({ host, profile }) => <button key={`${profile.kind}:${profile.id}`} className={styles.connection}
            disabled={disabled || !profile.available} title={profile.available ? undefined : profile.reason === 'desktop_capability_unsupported' ? copy.desktopUnsupported : copy.changedProfile}
            aria-label={`${profile.kind === 'desktop' ? copy.newDesktop : profile.kind === 'ssh' ? copy.newTerminal : copy.newFiles} · ${host.name} · ${profile.name}`}
            onClick={() => create(profile.id, profile.kind === 'desktop' ? 'desktop' : profile.kind === 'ssh' ? 'ssh' : 'files')}>
            <span className={styles['resource-icon']}>{profile.kind === 'desktop' ? <Monitor size={18} /> : profile.kind === 'ssh' ? <Terminal size={18} /> : <Folder size={18} />}</span>
            <span className={styles['resource-name']}><strong>{profile.name}</strong><small>{host.name}</small></span>
            <span className={styles.engine}>{profile.kind === 'ssh' ? 'SSH' : profile.engine.toUpperCase()}</span>
            <ArrowRight size={15} className={styles.arrow} />
          </button>)}
        </div> : <div className={styles['empty-list']}><Search size={20} /><span>{query ? copy.noResults : copy.noConnections}</span><small>{copy.emptyHint}</small></div>}
        {visible.length > 6 || sessions.length > 4 ? <Button type="link" className={styles.more} onClick={showResources}>{copy.allConnections}<ArrowRight size={14} /></Button> : null}
      </section>

      {openAgent ? <button className={styles.agent} onClick={openAgent} disabled={disabled}>
        <Bot size={20} /><span><strong>{copy.startAgent}</strong><small>{copy.agentEntryHint}</small></span><ArrowRight size={16} />
      </button> : null}
      <p className={styles.notice}><ShieldCheck size={14} />{copy.shellNotice}</p>
    </div>
  </div>
}
