import { vi } from 'vitest'
import type { RemoteLauncher, RemotePolicy, RemotePolicyChange, RemotePolicyEditor, RemoteResult } from '#common/contracts'
import { projectPolicy } from '../features/remote-control/model/policyEditor'

export const ok = <T,>(value: T): RemoteResult<T> => ({ ok: true, value: structuredClone(value) })
export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
export function policyGateway(initial: Partial<RemotePolicy> = {}, overrides: Partial<RemoteLauncher> = {}) {
  let current: RemotePolicy = { access_mode: 'custom', revision: 4, enabled: true, agent_enabled: false, hosts: [], directories: [], ...initial }
  const hosts: RemotePolicyEditor['hosts'] = [{ id: 'build', name: '构建主机', status: 'available' }, { id: 'prod', name: '生产主机', status: 'available' }]
  const desktops: RemotePolicyEditor['desktops'] = [{ id: 'rdp', host_id: 'build', name: '开发桌面', protocol: 'rdp', status: 'available' }]
  const apply = (revision: number, change: RemotePolicyChange) => {
    if (revision !== current.revision) return { ok: false as const, code: 'remote_policy_changed' }
    current = { ...projectPolicy(current, change, desktops), revision: revision + 1 }
    return ok({ policy: current, cleanup_pending: false, reconnect_desktop: false })
  }
  const api: RemoteLauncher = {
    devices: vi.fn(async () => ok([])), open: vi.fn(async () => ok(true)), openAgent: vi.fn(async () => ok(true)),
    policy: vi.fn(async () => ok(current)), hosts: vi.fn(async () => ok(hosts)),
    configure: vi.fn(async () => ok(current)), configureAgent: vi.fn(async () => ok(current)),
    addDirectory: vi.fn(async () => ok(null)), removeDirectory: vi.fn(async () => ok(current)),
    editPolicy: vi.fn(async () => ok({ policy: current, hosts, desktops })), closePolicyEditor: vi.fn(async () => ok(true)),
    changePolicy: vi.fn(async (_generation, _editor, revision, change) => apply(revision, change)),
    selectPolicyDirectory: vi.fn(async () => ok(null)), hostDesktopAccesses: vi.fn(async () => ok([])), ...overrides,
  }
  return { api, apply, policy: () => current }
}
