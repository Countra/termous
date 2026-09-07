import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyVNCTargetAuthDraft,
  createVNCTargetAuthDraft,
  isVNCTargetAuthDraftDirty,
  validateVNCTargetAuthDraft,
} from './vncTargetAuthDraft.ts'

test('目标认证草稿默认不修改服务端凭据', () => {
  const draft = createVNCTargetAuthDraft()
  assert.equal(isVNCTargetAuthDraftDirty(draft), false)
  assert.equal(validateVNCTargetAuthDraft(draft), undefined)
})

test('替换密码按 UTF-8 字节数校验且不裁剪空白', () => {
  assert.equal(validateVNCTargetAuthDraft({ mutation: 'replace', password: '' }), 'required')
  assert.equal(validateVNCTargetAuthDraft({ mutation: 'replace', password: ' '.repeat(4_096) }), undefined)
  assert.equal(validateVNCTargetAuthDraft({ mutation: 'replace', password: '密'.repeat(1_366) }), 'too_large')
})

test('移除凭据不要求填写密码', () => {
  const draft = { mutation: 'remove', password: '不应提交' } as const
  assert.equal(isVNCTargetAuthDraftDirty(draft), true)
  assert.equal(validateVNCTargetAuthDraft(draft), undefined)
})

test('凭据写入始终使用刚保存 Profile 的版本', async () => {
  const profile = {
    id: 'rdp_test',
    updated_at: '2026-08-26T01:02:03Z',
  } as Parameters<typeof applyVNCTargetAuthDraft>[0]
  const saved = { ...profile, updated_at: '2026-08-26T01:02:04Z' }
  const gateway = {
    saveRemoteDesktopTargetAuth: async (id: string, version: string, password: string) => {
      assert.deepEqual([id, version, password], [profile.id, profile.updated_at, ' secret '])
      return saved
    },
    deleteRemoteDesktopTargetAuth: async () => saved,
  }
  assert.equal(await applyVNCTargetAuthDraft(
    profile,
    { mutation: 'replace', password: ' secret ' },
    gateway,
  ), saved)
})
