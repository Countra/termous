import { fromJson } from '@bufbuild/protobuf'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from 'antd'
import { SessionSchema } from '@termous/remote-protocol'
import '#shared/styles'
import { TermousUiProvider } from '#app/ui-runtime'
import type { Session } from '#entities/remote-control'
import { RemoteDesktop } from '#features/remote-control'
import { LocalVNC } from './live-vnc-local'
import { liveAPI, liveClient, captureLiveDesktop } from './live-client'

export function Preview() {
  const [session, setSession] = useState<Session>()
  const [error, setError] = useState('')
  const [remote, setRemote] = useState(false)
  const [local, setLocal] = useState(true)
  const [diagnostics, setDiagnostics] = useState('')
  useEffect(() => { void liveAPI('session').then(value => setSession(fromJson(SessionSchema, value))).catch(error => setError(String(error))) }, [])
  const report = (work: Promise<unknown>) => { void work.then(value => setDiagnostics(JSON.stringify(value))).catch(error => setDiagnostics(String(error))) }
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <style>{'.live-vnc-surface { position: absolute; inset: 0; overflow: hidden; }'}</style>
    <div style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <strong>真实 Debian · VNC 远控联调</strong>
      <Button onClick={() => setRemote(value => !value)}>{remote ? '关闭远端观看' : '打开远端观看'}</Button>
      <Button onClick={() => setLocal(value => !value)}>{local ? '关闭本机窗口' : '打开本机窗口'}</Button>
      <Button onClick={() => report(liveAPI('diagnostics'))}>读取状态</Button>
      <Button onClick={() => report(captureLiveDesktop())}>验证远端截图</Button>
      <Button onClick={() => report(liveAPI('disconnect-parent', {}))}>断开业务连接</Button>
      <Button onClick={() => { setRemote(false); setLocal(false); setSession(undefined); report(liveAPI('result?passed=true', {})) }}>结束验证</Button>
    </div>
    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateRows: 'minmax(0, 1fr)', gridTemplateColumns: local && remote ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)' }}>
      {local && session && <LocalVNC />}
      {remote && session && <RemoteDesktop client={liveClient} session={session} active />}
      {!session && (error || '等待真实会话')}
    </div>
    <output style={{ maxHeight: 100, overflow: 'auto', fontSize: 11, overflowWrap: 'anywhere' }}>{diagnostics}</output>
  </div>
}
createRoot(document.getElementById('root')!).render(<TermousUiProvider language="zh-CN" theme="dark"><Preview /></TermousUiProvider>)
