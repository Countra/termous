import { createRoot } from 'react-dom/client'
import type { RemoteLauncher, RemotePolicy, RemoteResult } from '#common/contracts'
import { TermousUiProvider } from '#app/ui-runtime'
import { RemoteAccountAccess } from '#features/remote-control'
import '#shared/styles'

// 只使用内存合成数据；不连接账号、远程设备或原生目录选择器。
const query = new URLSearchParams(location.search)
document.body.dataset.termousMainSurface = 'true'
const empty = query.has('empty')
const hosts = empty ? [] : [
  { id: 'build', name: '构建工作站' }, { id: 'production', name: '生产服务器' },
  { id: 'lab', name: '测试环境' }, { id: 'storage', name: '文件存储' },
  { id: 'development', name: '开发主机' }, { id: 'archive', name: '归档服务器' },
]
const desktops = empty ? [] : [
  { id: 'rdp', host_id: 'build', name: 'Windows 开发环境', protocol: 'rdp' },
  { id: 'vnc', host_id: 'build', name: 'Linux 测试桌面', protocol: 'vnc' },
]
let policy: RemotePolicy = {
  access_mode: query.has('full') ? 'full' : 'custom', revision: 1, enabled: true, agent_enabled: false,
  host_desktop: { observe: true, control: false, secure_capture: false, secure_control: false },
  hosts: empty ? [] : [{ id: 'build', connections: [{ id: 'rdp', kind: 'desktop' }] }],
  directories: empty ? [] : [
    { id: 'reports', name: '项目文档', path: 'D:\\Workspace\\Termous\\documents', read: true, write: false },
    { id: 'releases', name: '构建产物', path: 'D:\\Workspace\\Termous\\releases', read: true, write: true },
  ],
}
const ok = <T,>(value: T): RemoteResult<T> => ({ ok: true, value: structuredClone(value) })
const update = (revision: number, changes: Partial<RemotePolicy>): RemoteResult<RemotePolicy> => {
  if (revision !== policy.revision) return { ok: false, code: 'remote_policy_changed' }
  policy = { ...policy, ...changes, revision: revision + 1 }
  return ok(policy)
}
const api: RemoteLauncher = {
  policy: async () => ok(policy), hosts: async () => ok(hosts), desktopProfiles: async () => ok(desktops),
  devices: async () => ok([]), open: async () => ({ ok: false, code: 'remote_not_supported' }),
  openAgent: async () => ({ ok: false, code: 'remote_not_supported' }),
  configure: async (_generation, revision, enabled, ids, mode) => update(revision, {
    enabled, access_mode: mode,
    hosts: ids === undefined ? policy.hosts : ids.map(id => (policy.hosts ?? []).find(host => host.id === id) ?? { id }),
  }),
  configureAgent: async (_generation, revision, enabled) => update(revision, { agent_enabled: enabled }),
  configureHostDesktop: async (_generation, revision, observe, control, secureCapture, secureControl) => update(revision, {
    host_desktop: { observe, control, secure_capture: secureCapture, secure_control: secureControl },
  }),
  configureDesktops: async (_generation, revision, ids, exchanges = []) => update(revision, {
    hosts: (policy.hosts ?? []).map(host => ({ ...host, connections: [
      ...ids.filter(id => desktops.some(profile => profile.id === id && profile.host_id === host.id)).map(id => ({ id, kind: 'desktop' })),
      ...exchanges.filter(id => ids.includes(id) && desktops.some(profile => profile.id === id && profile.host_id === host.id)).map(id => ({ id, kind: 'desktop_exchange' })),
    ] })),
  }),
  addDirectory: async (_generation, revision, write) => update(revision, {
    directories: [...(policy.directories ?? []), { id: crypto.randomUUID(), name: '共享目录', path: 'D:\\Shared', read: true, write }],
  }),
  removeDirectory: async (_generation, revision, id) => update(revision, { directories: (policy.directories ?? []).filter(root => root.id !== id) }),
  hostDesktopAccesses: async () => ok([]), stopHostDesktopAccess: async () => ok(null),
}
Object.defineProperty(window, 'termous', { configurable: true, value: { remoteControl: api } })

const root = createRoot(document.getElementById('root')!)
root.render(
  <TermousUiProvider language={query.has('en') ? 'en-US' : 'zh-CN'} theme={query.has('light') ? 'light' : 'dark'}>
    <main style={{ maxWidth: 1000, margin: '64px auto', padding: 24 }}>
      <RemoteAccountAccess generation="preview" currentDevice="current" trusted>{() => null}</RemoteAccountAccess>
    </main>
  </TermousUiProvider>,
)
import.meta.hot?.dispose(() => root.unmount())
