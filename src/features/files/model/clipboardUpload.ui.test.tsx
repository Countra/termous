import { clipboardCapabilitiesFixture } from '../../../test/systemClipboard'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readClipboardUpload } from './clipboardUpload'
import { createUploadWithConflictDecision } from '#features/transfers'
import { TermousApiError } from '#shared/api'

const fixture = vi.hoisted(() => ({ importClipboard: vi.fn() }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => ({ fileSystemClipboard: fixture }) }))

const grant = { id: 'grant', source: 'clipboard' as const, items: [{ id: 'file', name: '中文.txt', kind: 'file' as const, size: 12 }, { id: 'folder', name: '目录', kind: 'directory' as const }], created_at: '', expires_at: '' }
const session = { id: 'session', connection_generation: 7 }
beforeEach(() => { fixture.importClipboard.mockReset() })

describe('从系统剪贴板上传', () => {
  it('平台未支持时跳过本机导入，也不回退为文本路径读取', async () => {
    capabilities.disconnect()
    capabilities = clipboardCapabilitiesFixture('unsupported', 'ready')
    expect(await readClipboardUpload(session)).toBeNull()
    expect(fixture.importClipboard).not.toHaveBeenCalled()
  })

  it('已支持但断线时报告暂时不可用，不发送导入请求', async () => {
    capabilities.update({ status: 'disconnected' })
    await expect(readClipboardUpload(session)).rejects.toMatchObject({ code: 'FILE_CLIPBOARD_UNAVAILABLE' })
    expect(fixture.importClipboard).not.toHaveBeenCalled()
  })
  it('只向界面返回授权，多选和目录复用当前目录的上传任务', async () => {
    fixture.importClipboard.mockResolvedValue({ ok: true, value: { sequence: 12, grant } })
    const selection = await readClipboardUpload(session)
    expect(selection?.paths).toEqual([])
    const createUpload = vi.fn(async () => 'task')
    const releaseGrant = vi.fn()
    const task = await createUploadWithConflictDecision({
      source: 'clipboard', paths: [], targetPath: '/上传目录', createGrant: selection!.createGrant!, releaseGrant,
      stat: vi.fn(async () => { throw new TermousApiError('文件不存在', 'SFTP_PATH_NOT_FOUND', 404) }),
      requestPolicy: vi.fn(async () => 'rename' as const), isCurrent: () => true, createUpload,
    })
    expect(task).toBe('task')
    expect(createUpload).toHaveBeenCalledWith('grant', [], [])
    expect(fixture.importClipboard).toHaveBeenCalledWith({ file_session_id: 'session', connection_generation: 7 })
    expect(releaseGrant).not.toHaveBeenCalled()
  })

  it('确认冲突后按相同序号重新授权，剪贴板换代不能上传其他文件', async () => {
    fixture.importClipboard.mockResolvedValueOnce({ ok: true, value: { sequence: 12, grant } })
      .mockResolvedValueOnce({ ok: false, code: 'FILE_CLIPBOARD_CHANGED' })
    const selection = await readClipboardUpload(session)
    expect(await selection!.createGrant!()).toEqual(grant)
    await expect(selection!.createGrant!()).rejects.toMatchObject({ code: 'FILE_CLIPBOARD_CHANGED' })
    expect(fixture.importClipboard).toHaveBeenLastCalledWith({ file_session_id: 'session', connection_generation: 7, sequence: 12 })
  })

  it('连接在导入期间关闭时释放授权，不创建上传', async () => {
    fixture.importClipboard.mockResolvedValue({ ok: true, value: { sequence: 12, grant } })
    const selection = await readClipboardUpload(session)
    const releaseGrant = vi.fn(async () => undefined)
    const createUpload = vi.fn()
    expect(await createUploadWithConflictDecision({
      source: 'clipboard', paths: [], targetPath: '/original', createGrant: selection!.createGrant!, releaseGrant,
      stat: vi.fn(), requestPolicy: vi.fn(), isCurrent: () => false, createUpload,
    })).toBeNull()
    expect(releaseGrant).toHaveBeenCalledWith('grant')
    expect(createUpload).not.toHaveBeenCalled()
  })

  it('普通文本不当作文件路径；自有虚拟文件明确提示', async () => {
    fixture.importClipboard.mockResolvedValueOnce({ ok: true, value: { sequence: 13 } })
    expect(await readClipboardUpload(session)).toBeNull()
    fixture.importClipboard.mockResolvedValue({ ok: false, code: 'FILE_CLIPBOARD_PASTE_EXTERNAL' })
    await expect(readClipboardUpload(session)).rejects.toMatchObject({ code: 'FILE_CLIPBOARD_PASTE_EXTERNAL' })
  })
})

let capabilities: ReturnType<typeof clipboardCapabilitiesFixture>
beforeEach(() => { capabilities = clipboardCapabilitiesFixture() })
afterEach(() => capabilities.disconnect())
