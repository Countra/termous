import { create, fromJson, toJson } from '@bufbuild/protobuf'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from 'antd'
import { ResponseSchema, SessionSchema } from '@termous/remote-protocol'
import { DesktopRequestSchema } from '@termous/remote-protocol/desktop-protocol'
import '#shared/styles'
import { TermousUiProvider } from '#app/ui-runtime'
import type { RemoteClient, Session } from '#entities/remote-control'
import { RemoteDesktop } from '#features/remote-control'

// 仅连接同机合成夹具；显示组件和媒体传输均沿用生产实现。
const api = async (path: string, body?: unknown) => {
  const response = await fetch(`/fixture/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Termous-Fixture': 'desktop', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!response.ok) throw new Error(`fixture_http_${response.status}`)
  return response.status === 204 ? null : response.json()
}
const client = {
  desktop: async (input: Parameters<RemoteClient['desktop']>[0]) => {
    const response = fromJson(ResponseSchema, await api('request', toJson(DesktopRequestSchema, create(DesktopRequestSchema, input))))
    if (response.error) throw new Error(response.error.code)
    if (response.result.case !== 'desktop') throw new Error('invalid_fixture_response')
    return response.result.value
  },
  desktopICE: async () => [],
} as unknown as RemoteClient
export function Preview() {
  const [session, setSession] = useState<Session>()
  const [error, setError] = useState('')
  const [active, setActive] = useState(true)
  useEffect(() => { void api('session').then(value => setSession(fromJson(SessionSchema, value))).catch(error => setError(String(error))) }, [])
  return <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}><strong>开发工作站 · 远程桌面</strong><Button onClick={() => setActive(value => !value)}>切换标签可见性</Button><Button onClick={() => { setSession(undefined); void api('result?passed=true', {}) }}>结束验证</Button></div>
    <div style={{ flex: 1, minHeight: 0 }}>{session ? <RemoteDesktop client={client} session={session} active={active} /> : error || '等待夹具会话'}</div>
  </div>
}
createRoot(document.getElementById('root')!).render(<TermousUiProvider language="zh-CN" theme={location.search.includes('light') ? 'light' : 'dark'}><Preview /></TermousUiProvider>)
