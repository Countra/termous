import { useState } from 'react'
import { Alert, Button, Spin, Tabs, Tooltip } from 'antd'
import { Columns2, Folder, Terminal } from 'lucide-react'
import type { AppTheme } from '#common/contracts'
import { type Inventory, RemoteClient, type Session } from '#entities/remote-control'
import { RemoteFiles, RemoteHostKey, RemoteTerminal, type RemoteCopy } from '#features/remote-control'
import styles from './RemoteWorkbench.module.scss'

interface Props {
  client: RemoteClient; tabs: Session[]; selected: string; inventory?: Inventory
  copy: RemoteCopy; theme: AppTheme; name(session: Session): string
  select(id: string): void; close(id: string): void; changed(): void
}

export function RemoteSessionPanels({ client, tabs, selected, inventory, copy, theme, name, select, close, changed }: Props) {
  const [split, setSplit] = useState(false)
  const primary = tabs.find(item => item.id === selected)
  const secondary = tabs.find(item => item.kind !== primary?.kind)
  const paired = split && primary && secondary
  return <div className={styles.panels}>
    <Tabs type="editable-card" hideAdd activeKey={selected} onChange={select}
      onEdit={(key, action) => { if (action === 'remove') close(String(key)) }}
      tabBarExtraContent={<Tooltip title={copy.split}><Button type={split ? 'primary' : 'text'} disabled={!secondary} aria-label={copy.split} aria-pressed={split} icon={<Columns2 size={16} />} onClick={() => setSplit(value => !value)} /></Tooltip>}
      items={tabs.map(session => ({ key: session.id, label: <span className={styles.tab}>{session.kind === 'ssh' ? <Terminal size={14} /> : <Folder size={14} />}{name(session)}</span> }))} />
    <div className={`${styles.panes} ${paired ? styles.paired : ''}`}>
      {tabs.map(session => <section key={session.id} className={styles.pane} hidden={session.id !== selected && (!paired || session.id !== secondary.id)} aria-label={`${name(session)} · ${session.kind === 'ssh' ? copy.terminal : copy.files}`}>
        {session.hostKeyChallengeId ? <div className={styles.challenge}><RemoteHostKey key={session.hostKeyChallengeId} client={client} session={session} copy={copy} changed={changed} /></div>
          : session.state !== 'connected' ? <div className={styles.loading}>{session.state === 'connecting' ? <Spin /> : <Alert type="info" title={copy.disconnected} />}</div>
            : session.kind === 'ssh' ? <RemoteTerminal client={client} session={session} copy={copy} theme={theme} />
              : <RemoteFiles client={client} session={session} copy={copy} roots={inventory?.roots ?? []} operations={inventory?.operations ?? []} changed={changed} />}
      </section>)}
    </div>
  </div>
}
