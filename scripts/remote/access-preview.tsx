import { createRoot } from 'react-dom/client'
import type { RemoteLauncher, RemotePolicy, RemoteResult } from '#common/contracts'
import { TermousUiProvider } from '#app/ui-runtime'
import { RemoteAccountAccess } from '#features/remote-control'
import { projectPolicy } from '../../src/features/remote-control/model/policyEditor'
import '#shared/styles'

// 只使用内存合成数据；不连接账号、远程设备或原生目录选择器。
const query = new URLSearchParams(location.search)
document.body.dataset.termousMainSurface = 'true'
const empty = query.has('empty')
const hosts = empty ? [] : [
  { id: 'build', name: '构建工作站' }, { id: 'production', name: '生产服务器' },
  { id: 'lab', name: '测试环境' }, { id: 'storage', name: '文件存储' },
  { id: 'development', name: '开发主机' }, { id: 'archive', name: '归档服务器' },
  ...(query.has('long') ? Array.from({ length: 18 }, (_, i) => ({ id: `host-${i}`, name: `预览主机 ${i + 1}` })) : []),
]
const desktops = empty ? [] : [
  { id: 'rdp', host_id: 'build', name: 'Windows 开发环境', protocol: 'rdp' },
  { id: 'vnc', host_id: 'build', name: 'Linux 测试桌面', protocol: 'vnc' },
  ...(query.has('long') ? Array.from({ length: 10 }, (_, i) => ({ id: `desktop-${i}`, host_id: 'lab', name: `测试桌面 ${i + 1}`, protocol: 'rdp' })) : []),
]
let policy: RemotePolicy = {
  access_mode: query.has('full') ? 'full' : 'custom', revision: 1, enabled: true, agent_enabled: false,
  host_desktop: { observe: true, control: false, secure_capture: false, secure_control: false },
  hosts: empty ? [] : [{ id: 'build', connections: [{ id: 'rdp', kind: 'desktop' }] }],
  directories: empty ? [] : [
    { id: 'reports', name: '项目文档', path: 'D:\\Workspace\\Termous\\documents', read: true, write: false },
    { id: 'releases', name: '构建产物', path: 'D:\\Workspace\\Termous\\releases', read: true, write: true },
    ...(query.has('long') ? Array.from({ length: 10 }, (_, i) => ({ id: `folder-${i}`, name: `共享目录 ${i + 1}`, path: `D:\\Shared\\folder-${i + 1}`, read: true, write: false })) : []),
  ],
}
const ok = <T,>(value: T): RemoteResult<T> => ({ ok: true, value: structuredClone(value) })
const unsupported = async () => ({ ok: false as const, code: 'remote_not_supported' })
const api: RemoteLauncher = {
  editPolicy: async () => ok({ policy, hosts: hosts.map(h => ({ ...h, status: 'available' as const })), desktops: desktops.map(d => ({ ...d, status: 'available' as const })) }),
  closePolicyEditor: async () => ok(true), selectPolicyDirectory: async () => ok('fixture-selection'),
  changePolicy: async (_generation, _editor, revision, change) => {
    if (revision !== policy.revision) return { ok: false, code: 'remote_policy_changed' }
    await new Promise(resolve => setTimeout(resolve, 350))
    policy = { ...projectPolicy(policy, change, desktops.map(d => ({ ...d, status: 'available' }))), revision: revision + 1 }
    if (change.kind === 'directory_add') policy.directories = [...(policy.directories ?? []), { id: crypto.randomUUID(), name: '共享目录', path: 'D:\\Shared', read: true, write: change.write }]
    return ok({ policy, cleanup_pending: false, reconnect_desktop: false })
  },
  policy: async () => ok(policy), hosts: async () => ok(hosts),
  devices: async () => ok([]), open: unsupported, openAgent: unsupported,
  configure: unsupported, configureAgent: unsupported, addDirectory: unsupported, removeDirectory: unsupported,
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
