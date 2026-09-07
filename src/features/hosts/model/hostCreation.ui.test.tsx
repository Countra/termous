import { describe, expect, it, vi } from 'vitest'
import {
  addHostCreationRemoteDesktop,
  addHostCreationSSH,
  createHostCreationDraft,
  hostCreationTemporaryHostId,
  isHostCreationDirty,
  normalizeHostProvisionInput,
  projectHostCreationSSH,
  removeHostCreationConnection,
  setHostCreationDefault,
  updateHostCreationRemoteDesktop,
  updateHostCreationSSH,
  validateHostCreationDraft,
  type HostCreationDependencies,
  type HostCreationDraft,
} from './hostCreation.ts'

const dependencies: HostCreationDependencies = {
  sshProfiles: [],
  credentials: [{ id: 'credential-1', type: 'password' }],
  proxies: [{ id: 'proxy-1' }],
}

function hostDraft() {
  const state = createHostCreationDraft()
  return { ...state, host: { ...state.host, name: '新主机' } }
}

function addSSH(state: HostCreationDraft) {
  const added = addHostCreationSSH(state)
  const item = added.draft.ssh.find((entry) => entry.id === added.id)!
  return {
    id: added.id,
    draft: updateHostCreationSSH(added.draft, added.id, {
      draft: { ...item.draft, name: 'SSH', address: '10.0.0.1', username: 'root', credential_id: 'credential-1' },
    }),
  }
}

describe('host creation aggregate draft', () => {
  it('saves a host without any connection and normalizes metadata only at the request boundary', () => {
    const state = hostDraft()
    state.host.name = ' 新主机 '
    state.host.tags = [' 生产 ', '生产']
    expect(validateHostCreationDraft(state, dependencies).issues).toEqual([])
    expect(normalizeHostProvisionInput(state)).toEqual({
      client_request_id: state.clientRequestId,
      host: { ...state.host, name: '新主机', tags: ['生产'] },
      ssh: [],
      remote_desktops: [],
    })
    expect(state.host.name).toBe(' 新主机 ')
  })

  it('tracks the entire draft and discards connections and secrets by creating a fresh state', () => {
    const initial = createHostCreationDraft()
    expect(isHostCreationDirty(initial)).toBe(false)
    const added = addHostCreationRemoteDesktop(initial)
    const edited = updateHostCreationRemoteDesktop(added.draft, added.id, {
      targetAuthDraft: { mutation: 'replace', password: '本次密码' },
    })
    expect(isHostCreationDirty(edited)).toBe(true)
    expect(edited.clientRequestId).toBe(initial.clientRequestId)
    expect(initial.remoteDesktops).toEqual([])
    expect(added.draft.remoteDesktops[0].targetAuthDraft.password).toBe('')
    const reset = createHostCreationDraft()
    expect(isHostCreationDirty(reset)).toBe(false)
    expect(reset.clientRequestId).not.toBe(initial.clientRequestId)
    expect(JSON.stringify(reset)).not.toContain('本次密码')
    expect(removeHostCreationConnection(edited, 'remote_desktop', added.id).draft.remoteDesktops).toEqual([])
  })

  it('validates all unfinished rows, including rows outside the current editor', () => {
    const first = addHostCreationSSH(createHostCreationDraft())
    const second = addHostCreationSSH(first.draft)
    const third = addHostCreationRemoteDesktop(second.draft)
    const state = updateHostCreationSSH(third.draft, first.id, { fileName: '' })
    const result = validateHostCreationDraft(state, dependencies)
    expect(result.firstIssue).toEqual({ kind: 'asset', field: 'name', code: 'required' })
    expect(result.incomplete).toEqual({
      ssh: [first.id, second.id], file: [first.id], remote_desktop: [third.id],
    })
    expect(result.issues).toContainEqual({ kind: 'ssh', id: first.id, field: 'name', code: 'required' })
    expect(result.issues).toContainEqual({ kind: 'file', id: first.id, field: 'name', code: 'required' })
    const withHost = { ...state, host: hostDraft().host }
    expect(validateHostCreationDraft(withHost, dependencies).firstIssue?.id).toBe(first.id)
  })

  it('keeps independent SSH and SFTP defaults and promotes a remaining row on removal', () => {
    const first = addSSH(hostDraft())
    const second = addSSH(first.draft)
    let state = setHostCreationDefault(second.draft, 'file', second.id)
    expect(state.ssh.map((item) => [item.isDefault, item.fileIsDefault])).toEqual([[true, false], [false, true]])
    expect(setHostCreationDefault(state, 'ssh', 'missing')).toBe(state)
    state = removeHostCreationConnection(state, 'ssh', first.id).draft
    expect(state.ssh[0]).toMatchObject({ id: second.id, isDefault: true, fileIsDefault: true })
    expect(validateHostCreationDraft(state, dependencies).issues).toEqual([])
    expect(second.draft.ssh).toHaveLength(2)
  })

  it('keeps desktop defaults independent and rejects corrupted default groups', () => {
    const first = addHostCreationRemoteDesktop(hostDraft())
    const second = addHostCreationRemoteDesktop(first.draft)
    const selected = setHostCreationDefault(second.draft, 'remote_desktop', second.id)
    expect(selected.remoteDesktops.map((item) => item.isDefault)).toEqual([false, true])
    const removed = removeHostCreationConnection(selected, 'remote_desktop', second.id).draft
    expect(removed.remoteDesktops[0].isDefault).toBe(true)
    removed.remoteDesktops[0].isDefault = false
    expect(validateHostCreationDraft(removed, dependencies).issues).toContainEqual({
      kind: 'remote_desktop', id: first.id, field: 'is_default', code: 'exactly_one',
    })
  })

  it('blocks deletion of an SSH used by a new jump or active desktop tunnel without changing any draft', () => {
    const first = addSSH(hostDraft())
    const second = addSSH(first.draft)
    const linked = updateHostCreationSSH(second.draft, second.id, {
      draft: { ...second.draft.ssh[1].draft, jump_ssh_profile_id: first.id },
    })
    const desktop = addHostCreationRemoteDesktop(linked)
    const removed = removeHostCreationConnection(desktop.draft, 'ssh', first.id)
    expect(removed.draft).toBe(desktop.draft)
    expect(removed.blockedBy).toEqual([{ kind: 'ssh', id: second.id }, { kind: 'remote_desktop', id: desktop.id }])
  })

  it('does not treat inactive desktop route memory as an active SSH dependency', () => {
    const first = addSSH(hostDraft())
    const desktop = addHostCreationRemoteDesktop(first.draft)
    const edited = updateHostCreationRemoteDesktop(desktop.draft, desktop.id, {
      draft: {
        ...desktop.draft.remoteDesktops[0].draft, route: 'direct', name: 'VNC', ssh_profile_id: '',
        vnc: { ...desktop.draft.remoteDesktops[0].draft.vnc, target_host: '10.0.0.2' },
        route_memory: { ssh_profile_id: first.id, direct_target_host: '10.0.0.2' },
      },
    })
    const removed = removeHostCreationConnection(edited, 'ssh', first.id)
    expect(removed.blockedBy).toBeUndefined()
    expect(validateHostCreationDraft(removed.draft, dependencies).issues).toEqual([])
    expect(normalizeHostProvisionInput(removed.draft).remote_desktops[0]).not.toHaveProperty('ssh_draft_id')
  })

  it('validates missing credentials, credential types, proxies and saved jump references', () => {
    const first = addSSH(hostDraft())
    const invalid = updateHostCreationSSH(first.draft, first.id, {
      draft: {
        ...first.draft.ssh[0].draft, auth_method: 'private_key',
        proxy_id: 'gone-proxy', jump_ssh_profile_id: 'gone-jump',
      },
    })
    const issues = validateHostCreationDraft(invalid, dependencies).issues
    expect(issues).toEqual(expect.arrayContaining([
      { kind: 'ssh', id: first.id, field: 'credential_id', code: 'type_mismatch' },
      { kind: 'ssh', id: first.id, field: 'proxy_id', code: 'missing' },
      { kind: 'ssh', id: first.id, field: 'jump_ssh_profile_id', code: 'missing' },
    ]))
    expect(validateHostCreationDraft(first.draft, { ...dependencies, credentials: [] }).issues)
      .toContainEqual({ kind: 'ssh', id: first.id, field: 'credential_id', code: 'missing' })
  })

  it('validates self-reference, local jump cycles and nested jump chains', () => {
    const first = addSSH(hostDraft())
    const second = addSSH(first.draft)
    const setJump = (state: HostCreationDraft, id: string, jumpId: string) => updateHostCreationSSH(state, id, {
      draft: { ...state.ssh.find((item) => item.id === id)!.draft, jump_ssh_profile_id: jumpId },
    })
    const self = validateHostCreationDraft(setJump(second.draft, first.id, first.id), dependencies)
    expect(self.issues).toContainEqual({ kind: 'ssh', id: first.id, field: 'jump_ssh_profile_id', code: 'self_reference' })
    const cyclic = setJump(setJump(second.draft, first.id, second.id), second.id, first.id)
    expect(validateHostCreationDraft(cyclic, dependencies).issues.filter((issue) => issue.code === 'cycle')).toHaveLength(2)
    const third = addSSH(setJump(second.draft, second.id, first.id))
    const nested = setJump(third.draft, third.id, second.id)
    expect(validateHostCreationDraft(nested, dependencies).issues).toContainEqual({
      kind: 'ssh', id: third.id, field: 'jump_ssh_profile_id', code: 'nested_jump',
    })
  })

  it('keeps temporary SSH projection isolated and serializes local references using draft IDs', () => {
    const first = addSSH(hostDraft())
    const second = addSSH(first.draft)
    const linked = updateHostCreationSSH(second.draft, second.id, {
      draft: { ...second.draft.ssh[1].draft, jump_ssh_profile_id: ` ${first.id} ` }, fileName: ' 文件传输 ',
    })
    const desktop = addHostCreationRemoteDesktop(linked)
    const state = updateHostCreationRemoteDesktop(desktop.draft, desktop.id, {
      draft: { ...desktop.draft.remoteDesktops[0].draft, name: 'VNC' },
    })
    const projection = projectHostCreationSSH(state)
    expect(projection.every((item) => item.host_id === hostCreationTemporaryHostId && item.id.startsWith('draft:'))).toBe(true)
    expect(validateHostCreationDraft(state, dependencies).issues).toEqual([])
    const request = normalizeHostProvisionInput(state)
    expect(request.ssh[1]).toMatchObject({ draft_id: second.id, jump_draft_id: first.id, jump_ssh_profile_id: '', file_name: '文件传输' })
    expect(request.remote_desktops[0]).toMatchObject({ draft_id: desktop.id, ssh_draft_id: first.id })
    expect(request.remote_desktops[0]).not.toHaveProperty('host_id')
    expect(request.remote_desktops[0]).not.toHaveProperty('ssh_profile_id')
    expect(JSON.stringify(request)).not.toContain(hostCreationTemporaryHostId)
  })

  it('preserves saved jump IDs and refuses to serialize dangling local references', () => {
    const first = addSSH(hostDraft())
    const saved = { ...projectHostCreationSSH(first.draft)[0], id: 'saved-jump', host_id: 'saved-host' }
    const linked = updateHostCreationSSH(first.draft, first.id, {
      draft: { ...first.draft.ssh[0].draft, jump_ssh_profile_id: saved.id },
    })
    expect(validateHostCreationDraft(linked, { ...dependencies, sshProfiles: [saved] }).issues).toEqual([])
    expect(normalizeHostProvisionInput(linked).ssh[0].jump_ssh_profile_id).toBe('saved-jump')
    expect(normalizeHostProvisionInput(linked).ssh[0]).not.toHaveProperty('jump_draft_id')
    linked.ssh[0].draft.jump_ssh_profile_id = 'draft:missing'
    expect(() => normalizeHostProvisionInput(linked)).toThrow('本地 SSH 跳板草稿不存在')
    const desktop = addHostCreationRemoteDesktop(first.draft)
    desktop.draft.remoteDesktops[0].draft.ssh_profile_id = saved.id
    expect(validateHostCreationDraft(desktop.draft, { ...dependencies, sshProfiles: [saved] }).issues)
      .toContainEqual({ kind: 'remote_desktop', id: desktop.id, field: 'ssh_profile_id', code: 'missing' })
    expect(() => normalizeHostProvisionInput(desktop.draft)).toThrow('远程桌面引用的本地 SSH 草稿不存在')
  })

  it('keeps passwords in memory, validates them globally, and serializes only the active secret without trimming', () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    const desktop = addHostCreationRemoteDesktop(hostDraft())
    let state = updateHostCreationRemoteDesktop(desktop.draft, desktop.id, {
      draft: {
        ...desktop.draft.remoteDesktops[0].draft, name: 'VNC',
        vnc: { ...desktop.draft.remoteDesktops[0].draft.vnc, target_host: '10.0.0.2' },
      },
      targetAuthDraft: { mutation: 'replace', password: '' },
    })
    expect(validateHostCreationDraft(state, dependencies).firstIssue).toEqual({
      kind: 'remote_desktop', id: desktop.id, field: 'target_auth_password', code: 'required',
    })
    state = updateHostCreationRemoteDesktop(state, desktop.id, { targetAuthDraft: { mutation: 'replace', password: ' 密码 ' } })
    expect(normalizeHostProvisionInput(state).remote_desktops[0].target_auth_password).toBe(' 密码 ')
    state = updateHostCreationRemoteDesktop(state, desktop.id, { targetAuthDraft: { mutation: 'remove', password: ' 密码 ' } })
    expect(normalizeHostProvisionInput(state).remote_desktops[0]).not.toHaveProperty('target_auth_password')
    expect(storage).not.toHaveBeenCalled()
    storage.mockRestore()
  })
})
