import { useState } from 'react'
import { Button, Spin, Tooltip } from 'antd'
import { Columns2, Folder, Monitor, Terminal } from 'lucide-react'
import type { AppTheme, RemoteLocalTask } from '#common/contracts'
import { type Inventory, RemoteClient, type Session } from '#entities/remote-control'
import { RemoteDesktop, RemoteFeedback, RemoteFiles, RemoteHostKey, RemoteTerminal, type RemoteCopy } from '#features/remote-control'
import { SessionTabButton, SessionTabStrip } from '#shared/ui'
import styles from './RemoteWorkbench.module.scss'

interface Props {
  connected?: boolean
  onQuote?: (session: Session, text: string) => void
  client: RemoteClient; tabs: Session[]; selected: string; inventory?: Inventory
  localTasks?: RemoteLocalTask[]
  copy: RemoteCopy; theme: AppTheme; name(session: Session): string
  select(id: string): void; close(id: string): void; changed(): void
}

export function RemoteSessionPanels({ connected = true, client, tabs, selected, inventory, localTasks, copy, theme, name, select, close, changed, onQuote }: Props) {
  const [split, setSplit] = useState(false)
  const primary = tabs.find(item => item.id === selected)
  const secondary = tabs.find(item => item.kind !== primary?.kind)
  const paired = split && primary && secondary
  return <div className={styles.panels}>
    <div className={styles['session-toolbar']}>
      <SessionTabStrip className={styles['session-rail']} ariaLabel={copy.sessions} activeId={selected}
        contentKey={tabs.map(session => `${session.id}:${session.state}:${name(session)}`).join('|')}
        scrollLeftLabel={copy.scrollTabsLeft} scrollRightLabel={copy.scrollTabsRight}>
        {tabs.map(session => {
          const status = ['connected', 'ready', 'streaming', 'reattach_wait'].includes(session.state) ? 'connected'
            : session.state === 'connecting' ? 'connecting' : 'disconnected'
          const statusLabel = status === 'connected' ? copy.connected : status === 'connecting' ? copy.connecting : copy.disconnected
          const kind = session.kind === 'desktop' ? copy.desktop : session.kind === 'ssh' ? copy.terminal : copy.files
          const host = inventory?.hosts.find(item => item.id === session.hostId)?.name
          return <SessionTabButton key={session.id} data-session-tab-id={session.id} id={`remote-session-tab-${session.id}`}
            active={session.id === selected} role="tab" aria-selected={session.id === selected} aria-controls={`remote-session-${session.id}`}
            icon={session.kind === 'desktop' ? <Monitor size={16} /> : session.kind === 'ssh' ? <Terminal size={16} /> : <Folder size={16} />}
            label={name(session)} status={status} statusLabel={statusLabel} closeLabel={copy.closeView}
            tooltipTitle={[name(session), host, kind, statusLabel].filter(Boolean).join(' · ')}
            onClick={() => select(session.id)} onClose={() => close(session.id)} />
        })}
      </SessionTabStrip>
      <Tooltip title={copy.split}><Button className={styles['split-toggle']} type="text" disabled={!secondary}
        aria-label={copy.split} aria-pressed={Boolean(paired)} icon={<Columns2 size={16} />} onClick={() => setSplit(value => !value)} /></Tooltip>
    </div>
    <div className={`${styles.panes} ${paired ? styles.paired : ''}`}>
      {tabs.map(session => <section key={session.id} id={`remote-session-${session.id}`} role="tabpanel" aria-labelledby={`remote-session-tab-${session.id}`} className={styles.pane} hidden={session.id !== selected && (!paired || session.id !== secondary.id)}>
        {session.kind === 'desktop' ? connected ? <RemoteDesktop client={client} session={session} localTasks={localTasks} changed={changed} active={session.id === selected || !!paired && session.id === secondary.id} /> : <div className={styles.loading}><Spin /><span>{copy.recovering}</span></div> : session.hostKeyChallengeId ? <div className={styles.challenge}><RemoteHostKey key={session.hostKeyChallengeId} client={client} session={session} copy={copy} changed={changed} /></div>
          : session.state !== 'connected' ? <div className={styles.loading}>{session.state === 'connecting' ? <Spin /> : <RemoteFeedback tone="info" message={copy.disconnected} />}</div>
            : session.kind === 'ssh' ? <RemoteTerminal onQuote={onQuote ? text => onQuote(session, text) : undefined} client={client} session={session} copy={copy} theme={theme} />
              : <RemoteFiles client={client} session={session} copy={copy} roots={inventory?.roots ?? []} operations={inventory?.operations ?? []} transfers={inventory?.transfers} localTasks={localTasks} changed={changed} />}
      </section>)}
    </div>
  </div>
}
