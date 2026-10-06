import { useState } from 'react'
import { Button, Spin, Tabs, Tooltip } from 'antd'
import { Columns2, Folder, Terminal, X } from 'lucide-react'
import type { AppTheme, RemoteLocalTask } from '#common/contracts'
import { type Inventory, RemoteClient, type Session } from '#entities/remote-control'
import { RemoteFeedback, RemoteFiles, RemoteHostKey, RemoteTerminal, type RemoteCopy } from '#features/remote-control'
import styles from './RemoteWorkbench.module.scss'

interface Props {
  onQuote?: (session: Session, text: string) => void
  client: RemoteClient; tabs: Session[]; selected: string; inventory?: Inventory
  localTasks?: RemoteLocalTask[]
  copy: RemoteCopy; theme: AppTheme; name(session: Session): string
  select(id: string): void; close(id: string): void; changed(): void
}

export function RemoteSessionPanels({ client, tabs, selected, inventory, localTasks, copy, theme, name, select, close, changed, onQuote }: Props) {
  const [split, setSplit] = useState(false)
  const primary = tabs.find(item => item.id === selected)
  const secondary = tabs.find(item => item.kind !== primary?.kind)
  const paired = split && primary && secondary
  return <div className={styles.panels}>
    <Tabs type="editable-card" hideAdd activeKey={selected} onChange={select}
      onEdit={(key, action) => { if (action === 'remove') close(String(key)) }}
      tabBarExtraContent={<Tooltip title={copy.split}><Button type={split ? 'primary' : 'text'} disabled={!secondary} aria-label={copy.split} aria-pressed={split} icon={<Columns2 size={16} />} onClick={() => setSplit(value => !value)} /></Tooltip>}
      items={tabs.map(session => ({ key: session.id, closeIcon: <Tooltip title={copy.closeViewHint}><X size={13} aria-label={copy.closeView} /></Tooltip>, label: <span className={styles.tab}>{session.kind === 'ssh' ? <Terminal size={14} /> : <Folder size={14} />}<span title={name(session)}>{name(session)}</span><span className={`${styles.dot} ${session.state === 'connected' ? styles.online : styles.offline}`} /></span> }))} />
    <div className={`${styles.panes} ${paired ? styles.paired : ''}`}>
      {tabs.map(session => <section key={session.id} className={styles.pane} hidden={session.id !== selected && (!paired || session.id !== secondary.id)} aria-label={`${name(session)} · ${session.kind === 'ssh' ? copy.terminal : copy.files}`}>
        {session.hostKeyChallengeId ? <div className={styles.challenge}><RemoteHostKey key={session.hostKeyChallengeId} client={client} session={session} copy={copy} changed={changed} /></div>
          : session.state !== 'connected' ? <div className={styles.loading}>{session.state === 'connecting' ? <Spin /> : <RemoteFeedback tone="info" message={copy.disconnected} />}</div>
            : session.kind === 'ssh' ? <RemoteTerminal onQuote={onQuote ? text => onQuote(session, text) : undefined} client={client} session={session} copy={copy} theme={theme} />
              : <RemoteFiles client={client} session={session} copy={copy} roots={inventory?.roots ?? []} operations={inventory?.operations ?? []} transfers={inventory?.transfers} localTasks={localTasks} changed={changed} />}
      </section>)}
    </div>
  </div>
}
