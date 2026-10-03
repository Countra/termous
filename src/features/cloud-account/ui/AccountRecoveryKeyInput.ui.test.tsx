import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import type { CloudDevice, CloudStatus } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
import { changeLanguage } from '#shared/i18n'
import { TermousApiError } from '#shared/api'
import { readRecoveryKeyFile } from '../model/recoveryKeyFile'
import { AccountRecoveryKeyInput } from './AccountRecoveryKeyInput'
import { AccountPersonalAuthorize } from './AccountPersonalAuthorize'
import { AccountArchives } from './AccountArchives'

beforeAll(async () => { await changeLanguage('zh-CN') })
const content = '{"format":"termous-personal-recovery-key","recovery_key":"synthetic-only"}'
const file = () => new File([content], 'recovery.torkey', { type: 'application/json' })
const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => { try { return await action() } catch { return undefined } }
const status: CloudStatus = { generation: 'fixture', revision: 1, configured: true, authenticated: true, phase: 'blocked', device_status: 'pending', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }
function fixture() {
  const state = new CloudState(); state.accept(status)
  const api = { getStatus: state.snapshot, subscribeStatus: state.subscribe, recoverPersonal: vi.fn(async () => ({ status: 'acknowledged' })), status: vi.fn(async () => status) } as unknown as CloudGateway
  return { api, state }
}

test.each(['选择', '拖入'])('%s 密钥文件后自动提交一次，文件正文不在页面显示', async method => {
  const onRecover = vi.fn(async () => undefined)
  render(<AccountRecoveryKeyInput disabled={false} onRecover={onRecover} />)
  if (method === '选择') fireEvent.change(screen.getByLabelText('选择恢复密钥文件'), { target: { files: [file()] } })
  else fireEvent.drop(screen.getByRole('button', { name: /选择恢复密钥文件/ }), { dataTransfer: { files: [file()] } })
  await waitFor(() => expect(onRecover).toHaveBeenCalledExactlyOnceWith({ recovery_file: content }))
  expect(screen.queryByText(content)).not.toBeInTheDocument()
  expect(screen.getByLabelText('选择恢复密钥文件')).toHaveValue('')
})

test('拒绝超限、错误后缀、多文件和损坏编码，取消选择不报错', async () => {
  const onRecover = vi.fn(async () => undefined)
  render(<AccountRecoveryKeyInput disabled={false} onRecover={onRecover} />)
  const input = screen.getByLabelText('选择恢复密钥文件')
  fireEvent.change(input, { target: { files: [] } })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  for (const files of [[new File(['x'.repeat(4097)], 'large.torkey')], [new File([content], 'key.txt')], [file(), file()], [new File([new Uint8Array([255])], 'invalid.torkey')]]) {
    fireEvent.change(input, { target: { files } })
    await screen.findByRole('alert')
    await waitFor(() => expect(input).not.toBeDisabled())
  }
  expect(onRecover).not.toHaveBeenCalled()
})

test('读取结束前卸载组件，不向旧账号提交密钥', async () => {
  const onRecover = vi.fn(async () => undefined)
  const view = render(<AccountRecoveryKeyInput disabled={false} onRecover={onRecover} />)
  fireEvent.change(screen.getByLabelText('选择恢复密钥文件'), { target: { files: [file()] } })
  view.unmount()
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(onRecover).not.toHaveBeenCalled()
  await expect(readRecoveryKeyFile(file(), AbortSignal.abort())).rejects.toThrow('CLOUD_STALE')
})

test('读取期间入口禁用时取消提交，重新启用后可以再选同一文件', async () => {
  const onRecover = vi.fn(async () => undefined)
  const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(() => undefined)
  try {
    const view = render(<AccountRecoveryKeyInput disabled={false} onRecover={onRecover} />)
    fireEvent.change(screen.getByLabelText('选择恢复密钥文件'), { target: { files: [file()] } })
    view.rerender(<AccountRecoveryKeyInput disabled onRecover={onRecover} />)
    const reader = read.mock.instances[0] as FileReader
    const bytes = new Uint8Array(new ArrayBuffer(content.length)); bytes.set(Array.from(content, character => character.charCodeAt(0)))
    Object.defineProperty(reader, 'result', { value: bytes.buffer })
    await act(async () => { reader.onload?.call(reader, new ProgressEvent('load') as ProgressEvent<FileReader>) })
    expect(onRecover).not.toHaveBeenCalled()
    read.mockRestore()
    view.rerender(<AccountRecoveryKeyInput disabled={false} onRecover={onRecover} />)
    fireEvent.change(screen.getByLabelText('选择恢复密钥文件'), { target: { files: [file()] } })
    await waitFor(() => expect(onRecover).toHaveBeenCalledExactlyOnceWith({ recovery_file: content }))
  } finally { read.mockRestore() }
})

test('文件读取完成后使用当前设备替换选择', async () => {
  const { api } = fixture()
  const device = { id: 'device_old', name: '旧设备', status: 'active' } as CloudDevice
  const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(() => undefined)
  try {
    render(<AccountPersonalAuthorize api={api} status={status} devices={[device]} enabled busy={false} disabled={false} run={run} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '使用个人恢复密钥' }))
    fireEvent.click(screen.getByText('需要替换的旧设备（可选）'))
    const checkbox = screen.getByRole('checkbox', { name: '旧设备' })
    fireEvent.click(checkbox)
    fireEvent.change(screen.getByLabelText('选择恢复密钥文件'), { target: { files: [file()] } })
    fireEvent.click(checkbox)
    const reader = read.mock.instances[0] as FileReader
    const bytes = new Uint8Array(new ArrayBuffer(content.length)); bytes.set(Array.from(content, character => character.charCodeAt(0)))
    Object.defineProperty(reader, 'result', { value: bytes.buffer })
    await act(async () => { reader.onload?.call(reader, new ProgressEvent('load') as ProgressEvent<FileReader>) })
    expect(api.recoverPersonal).toHaveBeenCalledExactlyOnceWith('fixture', { recovery_file: content }, [])
  } finally { read.mockRestore() }
})

test('旧版文本仍可使用，输入仅在展开时保留', async () => {
  const onRecover = vi.fn(async () => undefined)
  render(<AccountRecoveryKeyInput disabled={false} onRecover={onRecover} />)
  fireEvent.click(screen.getByRole('button', { name: '使用旧版文本密钥' }))
  fireEvent.change(screen.getByLabelText('个人恢复密钥'), { target: { value: 'TRK1-synthetic' } })
  fireEvent.click(screen.getByRole('button', { name: '校验并继续' }))
  await waitFor(() => expect(onRecover).toHaveBeenCalledWith({ recovery_key: 'TRK1-synthetic' }))
  await waitFor(() => expect(screen.getByLabelText('个人恢复密钥')).toHaveValue(''))
})

test('旧文本重试清除文件错误，并在处理期间锁定输入和重复提交', async () => {
  let complete!: () => void
  const onRecover = vi.fn(() => new Promise<void>(resolve => { complete = resolve }))
  render(<AccountRecoveryKeyInput disabled={false} onRecover={onRecover} />)
  fireEvent.change(screen.getByLabelText('选择恢复密钥文件'), { target: { files: [new File([content], 'key.txt')] } })
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: '使用旧版文本密钥' }))
  const field = screen.getByLabelText('个人恢复密钥')
  fireEvent.change(field, { target: { value: 'TRK1-synthetic' } })
  await act(async () => { fireEvent.submit(field.closest('form')!) })
  await waitFor(() => expect(onRecover).toHaveBeenCalledOnce())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(field).toBeDisabled()
  expect(screen.getByLabelText('选择恢复密钥文件')).toBeDisabled()
  await act(async () => { fireEvent.submit(field.closest('form')!) })
  expect(onRecover).toHaveBeenCalledOnce()
  await act(async () => { complete() })
  expect(screen.getByLabelText('个人恢复密钥')).toHaveValue('')
  expect(screen.getByLabelText('个人恢复密钥')).toBeEnabled()
})

test('更换 Core 时取消未完成的文件读取，不向任一网关提交', async () => {
  const previous = fixture(), next = fixture()
  const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(() => undefined)
  try {
    const view = render(<AccountPersonalAuthorize api={previous.api} status={status} devices={[]} enabled busy={false} disabled={false} run={run} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '使用个人恢复密钥' }))
    fireEvent.change(screen.getByLabelText('选择恢复密钥文件'), { target: { files: [file()] } })
    view.rerender(<AccountPersonalAuthorize api={next.api} status={status} devices={[]} enabled busy={false} disabled={false} run={run} onChanged={vi.fn()} />)
    const reader = read.mock.instances[0] as FileReader
    const bytes = new Uint8Array(new ArrayBuffer(content.length)); bytes.set(Array.from(content, character => character.charCodeAt(0)))
    Object.defineProperty(reader, 'result', { value: bytes.buffer })
    await act(async () => { reader.onload?.call(reader, new ProgressEvent('load') as ProgressEvent<FileReader>) })
    expect(previous.api.recoverPersonal).not.toHaveBeenCalled()
    expect(next.api.recoverPersonal).not.toHaveBeenCalled()
  } finally { read.mockRestore() }
})

test('关闭并重开授权弹窗后，退出动画中的旧文件结果不能提交恢复', async () => {
  const { api } = fixture()
  const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(() => undefined)
  try {
    render(<AccountPersonalAuthorize api={api} status={status} devices={[]} enabled busy={false} disabled={false} run={run} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '使用个人恢复密钥' }))
    fireEvent.change(screen.getByLabelText('选择恢复密钥文件'), { target: { files: [file()] } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: '使用个人恢复密钥' }))
    const reader = read.mock.instances[0] as FileReader
    const bytes = new Uint8Array(new ArrayBuffer(content.length)); bytes.set(Array.from(content, character => character.charCodeAt(0)))
    Object.defineProperty(reader, 'result', { value: bytes.buffer })
    await act(async () => { reader.onload?.call(reader, new ProgressEvent('load') as ProgressEvent<FileReader>) })
    expect(api.recoverPersonal).not.toHaveBeenCalled()
  } finally { read.mockRestore() }
})

test('授权入口将文件交给 Core，校验失败保留入口，可重新选择同一文件', async () => {
  const { api } = fixture()
  vi.mocked(api.recoverPersonal).mockRejectedValueOnce(new TermousApiError('文件不匹配', 'CLOUD_PERSONAL_FILE_MISMATCH', 400))
  const changed = vi.fn()
  render(<AccountPersonalAuthorize api={api} status={status} devices={[]} enabled busy={false} disabled={false} run={run} onChanged={changed} />)
  fireEvent.click(screen.getByRole('button', { name: '使用个人恢复密钥' }))
  fireEvent.change(screen.getByLabelText('选择恢复密钥文件'), { target: { files: [file()] } })
  await screen.findByText('文件不属于当前服务、账号或工作区，请选择对应的密钥文件。')
  expect(changed).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByLabelText('选择恢复密钥文件')).not.toBeDisabled())
  fireEvent.change(screen.getByLabelText('选择恢复密钥文件'), { target: { files: [file()] } })
  await waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(api.recoverPersonal).toHaveBeenLastCalledWith('fixture', { recovery_file: content }, [])
})

test('归档导入仅生成预览，不应用数据或自动上传', async () => {
  const { api } = fixture()
  api.archives = vi.fn<CloudGateway['archives']>(async () => [{ id: 'archive_test', status: 'archived', revision: '1', expires_at: new Date(Date.now() + 600_000).toISOString(), local_key_available: false }])
  api.previewArchive = vi.fn(async () => ({ id: 'preview', generation: 'fixture', blocked: false, items: [], conflicts: [], workspace_id: 'archive_test', expires_at: new Date(Date.now() + 300_000).toISOString() }))
  api.applyArchive = vi.fn()
  render(<AccountArchives api={api} status={status} busy={false} run={run} />)
  fireEvent.click(await screen.findByRole('button', { name: '取回到本地' }))
  fireEvent.drop(screen.getByRole('button', { name: /选择恢复密钥文件/ }), { dataTransfer: { files: [file()] } })
  await waitFor(() => expect(api.previewArchive).toHaveBeenCalledExactlyOnceWith('fixture', 'archive_test', { recovery_file: content }))
  expect(api.applyArchive).not.toHaveBeenCalled()
})

test('关闭归档弹窗后，退出动画中的文件结果不能读取归档', async () => {
  const { api } = fixture()
  api.archives = vi.fn<CloudGateway['archives']>(async () => [{ id: 'archive_test', status: 'archived', revision: '1', expires_at: new Date(Date.now() + 600_000).toISOString(), local_key_available: false }])
  api.previewArchive = vi.fn()
  const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(() => undefined)
  try {
    render(<AccountArchives api={api} status={status} busy={false} run={run} />)
    fireEvent.click(await screen.findByRole('button', { name: '取回到本地' }))
    fireEvent.change(screen.getByLabelText('选择恢复密钥文件'), { target: { files: [file()] } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    const reader = read.mock.instances[0] as FileReader
    const bytes = new Uint8Array(new ArrayBuffer(content.length)); bytes.set(Array.from(content, character => character.charCodeAt(0)))
    Object.defineProperty(reader, 'result', { value: bytes.buffer })
    await act(async () => { reader.onload?.call(reader, new ProgressEvent('load') as ProgressEvent<FileReader>) })
    expect(api.previewArchive).not.toHaveBeenCalled()
  } finally { read.mockRestore() }
})
