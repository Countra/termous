import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import { changeLanguage } from '#shared/i18n'
import type { CloudProfile } from '#common/contracts'
import { AccountProfile } from './AccountProfile'

beforeAll(async () => { await changeLanguage('zh-CN') })
const profile: CloudProfile = { user_id: 'synthetic', revision: '3', name: 'Existing', bio: '', organization: '', avatar: 'data:image/png;base64,aGVsbG8=', updated_at: null }

test('编辑、清除头像只在保存时提交，并携带原版本', async () => {
  const save = vi.fn(async () => true)
  render(<AccountProfile profile={profile} loading={false} save={save} reload={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Updated' } })
  fireEvent.change(screen.getByLabelText('公司／组织'), { target: { value: 'Synthetic Org' } })
  fireEvent.change(screen.getByLabelText('简介'), { target: { value: 'Bio' } })
  fireEvent.click(screen.getByRole('button', { name: '移除头像' }))
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存资料' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith({ expected_revision: '3', name: 'Updated', organization: 'Synthetic Org', bio: 'Bio', avatar: '' }))
})

test('版本冲突保留草稿和原版本，超长资料不能提交', async () => {
  const save = vi.fn(async () => false)
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
