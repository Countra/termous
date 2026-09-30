import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import { changeLanguage } from '#shared/i18n'
import type { CloudProfile } from '#common/contracts'
import { AccountProfile } from './AccountProfile'

beforeAll(async () => { await changeLanguage('zh-CN') })
const profile: CloudProfile = { user_id: 'synthetic', revision: '3', name: 'Existing', bio: '', organization: '', avatar: 'data:image/png;base64,aGVsbG8=', updated_at: null }

test('编辑、清除头像只在保存时提交，并携带原版本', async () => {
  const save = vi.fn(async () => ({ ...profile, name: 'Updated', organization: 'Synthetic Org', bio: 'Bio', avatar: '', revision: '4' }))
  render(<AccountProfile profile={profile} loading={false} save={save} reload={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Updated' } })
  fireEvent.change(screen.getByLabelText('公司／组织'), { target: { value: 'Synthetic Org' } })
  fireEvent.change(screen.getByLabelText('简介'), { target: { value: 'Bio' } })
  fireEvent.click(screen.getByRole('button', { name: '移除头像' }))
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存资料' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith({ expected_revision: '3', name: 'Updated', organization: 'Synthetic Org', bio: 'Bio', avatar: '' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '保存资料' })).toBeDisabled())
  expect(screen.getByLabelText('名称')).toHaveValue('Updated')
})

test('版本冲突保留草稿和原版本，超长资料不能提交', async () => {
  const save = vi.fn(async () => undefined)
  const props = { profile, loading: false, save, reload: vi.fn() }
  const view = render(<AccountProfile {...props} />)
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Draft' } })
  view.rerender(<AccountProfile {...props} error="profile_conflict" />)
  expect(screen.getByLabelText('名称')).toHaveValue('Draft')
  expect(screen.getByText(/当前草稿已保留/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '😀'.repeat(65) } })
  expect(screen.getByRole('button', { name: '保存资料' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '😀'.repeat(64) } })
  expect(screen.getByRole('button', { name: '保存资料' })).toBeEnabled()
  expect(save).not.toHaveBeenCalled()
})

test('后台刷新更新未编辑资料；已有草稿保留字段与原始版本', async () => {
  const save = vi.fn(async () => undefined)
  const props = { loading: false, save, reload: vi.fn() }
  const view = render(<AccountProfile {...props} profile={profile} />)
  view.rerender(<AccountProfile {...props} profile={{ ...profile, name: 'Remote', revision: '4' }} />)
  expect(screen.getByLabelText('名称')).toHaveValue('Remote')
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Draft' } })
  view.rerender(<AccountProfile {...props} profile={{ ...profile, name: 'New remote', revision: '5' }} />)
  expect(screen.getByLabelText('名称')).toHaveValue('Draft')
  fireEvent.click(screen.getByRole('button', { name: '保存资料' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Draft', expected_revision: '4' })))
})

test.each([false, true])('确认重新载入后才丢弃草稿，读取失败仍保留草稿：%s', async (success) => {
  const reload = vi.fn(async () => success ? { ...profile, name: 'Remote', revision: '4' } : undefined)
  render(<AccountProfile profile={profile} loading={false} save={vi.fn()} reload={reload} />)
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Draft' } })
  fireEvent.click(screen.getByRole('button', { name: '重新载入' }))
  expect(reload).not.toHaveBeenCalled()
  fireEvent.click(await screen.findByRole('button', { name: /确定|确 定|OK/ }))
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.getByLabelText('名称')).toHaveValue(success ? 'Remote' : 'Draft'))
  expect(screen.getByRole('button', { name: '保存资料' }).hasAttribute('disabled')).toBe(success)
})

test.each(['pristine', 'too-long', 'loading'] as const)('表单提交入口与保存按钮遵循相同边界：%s', async (state) => {
  const save = vi.fn(async () => profile)
  const props = { profile, loading: false, save, reload: vi.fn() }
  const view = render(<AccountProfile {...props} />)
  if (state !== 'pristine') fireEvent.change(screen.getByLabelText('名称'), { target: { value: state === 'too-long' ? '😀'.repeat(65) : 'Draft' } })
  if (state === 'loading') view.rerender(<AccountProfile {...props} loading />)
  expect(screen.getByRole('button', { name: /保存资料/ })).toBeDisabled()
  const form = screen.getByLabelText('名称').closest('form')!
  await act(async () => { fireEvent.submit(form) })
  expect(save).not.toHaveBeenCalled()
})
