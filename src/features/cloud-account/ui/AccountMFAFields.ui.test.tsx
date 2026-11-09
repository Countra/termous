import { useState } from 'react'
import { Button, Form, Input } from 'antd'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, expect, test, vi } from 'vitest'
import type { CloudMFAMethod } from '#common/contracts'
import { changeLanguage } from '#shared/i18n'
import { renderWithFeedback as render } from '../../../test/renderWithFeedback'
import { AccountMFAFields } from './AccountMFAFields'
import { AccountStepUpFields } from './AccountStepUpFields'

beforeAll(async () => { await changeLanguage('zh-CN') })

function Fixture({ submit, disabled = false, autoSubmit = true, email = false }: { submit: (value: { code: string }) => void; disabled?: boolean; autoSubmit?: boolean; email?: boolean }) {
  const [method, setMethod] = useState<CloudMFAMethod>('totp')
  const [form] = Form.useForm()
  return <Form form={form} layout="vertical" onFinish={submit}>
    {email ? <Form.Item name="email" label="邮箱串" rules={[{ required: true, message: '请输入邮箱串' }]}><Input /></Form.Item> : null}
    <AccountMFAFields method={method} disabled={disabled} autoSubmit={autoSubmit} onMethodChange={next => { setMethod(next); form.setFieldValue('code', undefined) }} />
    <Button htmlType="submit" disabled={disabled}>验证</Button>
  </Form>
}
const slots = () => within(screen.getByRole('group', { name: '六位验证码' })).getAllByRole('textbox') as HTMLInputElement[]
const code = () => slots().map(input => input.value).join('')

test('逐位输入后自动提交一次，保留失败草稿，编辑和再次填满只能手动验证', async () => {
  const submit = vi.fn()
  const user = userEvent.setup()
  render(<Fixture submit={submit} />)
  await user.type(slots()[0], '123456')
  await waitFor(() => expect(submit).toHaveBeenCalledExactlyOnceWith({ code: '123456' }))
  expect(code()).toBe('123456')
  expect(slots()[5]).toHaveFocus()
  await user.keyboard('{ArrowLeft}9')
  expect(code()).toBe('123496')
  await user.keyboard('{Home}{Delete}7')
  expect(code()).toBe('723496')
  await user.click(slots()[2])
  await user.keyboard('8')
  expect(code()).toBe('728496')
  await user.keyboard('{End}78')
  expect(code()).toBe('728498')
  expect(submit).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: /^验\s*证$/ }))
  await waitFor(() => expect(submit).toHaveBeenLastCalledWith({ code: '728498' }))
  expect(submit).toHaveBeenCalledTimes(2)
})

test('完整粘贴从首位填入，保留前导零且不重复自动验证', async () => {
  const submit = vi.fn()
  const user = userEvent.setup()
  render(<Fixture submit={submit} />)
  await user.click(slots()[3])
  await user.paste('012 345')
  await waitFor(() => expect(submit).toHaveBeenCalledExactlyOnceWith({ code: '012345' }))
  await user.paste('654321')
  expect(code()).toBe('654321')
  expect(submit).toHaveBeenCalledTimes(1)
})

test('原生自动填充和移动端输入可替换当前数字，失败后仍只能手动提交', async () => {
  const submit = vi.fn()
  render(<Fixture submit={submit} />)
  fireEvent.input(slots()[0], { target: { value: '012345' }, inputType: 'insertReplacementText', data: '012345' })
  await waitFor(() => expect(submit).toHaveBeenCalledExactlyOnceWith({ code: '012345' }))
  fireEvent.input(slots()[5], { target: { value: '56' }, inputType: 'insertText', data: '6' })
  expect(code()).toBe('012346')
  fireEvent.input(slots()[5], { target: { value: '76' }, inputType: 'insertText', data: '7' })
  expect(code()).toBe('012347')
  expect(submit).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: /^验\s*证$/ }))
  await waitFor(() => expect(submit).toHaveBeenLastCalledWith({ code: '012347' }))
  expect(submit).toHaveBeenCalledTimes(2)
})

test('删除中间位保留其他位置，退格、首尾和方向键可定位，未填满不能提交', async () => {
  const submit = vi.fn()
  const user = userEvent.setup()
  render(<Fixture submit={submit} autoSubmit={false} />)
  await user.type(slots()[0], '123456')
  await user.click(slots()[2])
  await user.keyboard('{Delete}')
  expect(slots().map(input => input.value)).toEqual(['1', '2', '', '4', '5', '6'])
  await user.click(screen.getByRole('button', { name: /^验\s*证$/ }))
  await screen.findByText('请输入 6 位数字验证码')
  expect(submit).not.toHaveBeenCalled()
  await user.click(slots()[2])
  await user.keyboard('{Backspace}')
  expect(slots()[1]).toHaveFocus()
  expect(slots()[1]).toHaveValue('')
  await user.keyboard('83{End}{ArrowRight}')
  expect(slots()[5]).toHaveFocus()
  await user.click(screen.getByRole('button', { name: /^验\s*证$/ }))
  await waitFor(() => expect(submit).toHaveBeenCalledExactlyOnceWith({ code: '183456' }))
})

test('拒绝非数字和过长粘贴，禁用时不接受输入或自动提交', async () => {
  const submit = vi.fn()
  const user = userEvent.setup()
  const view = render(<Fixture submit={submit} />)
  await user.click(slots()[0])
  await user.paste('code:123456')
  await user.paste('1234567')
  await user.keyboard('abc')
  expect(code()).toBe('')
  view.rerender(<Fixture submit={submit} disabled />)
  expect(slots().every(input => input.disabled)).toBe(true)
  fireEvent.change(slots()[0], { target: { value: '123456' } })
  expect(submit).not.toHaveBeenCalled()
})

test('自动验证遵守其他必填字段，修正后需手动提交，备用码继续文本输入', async () => {
  const submit = vi.fn()
  const user = userEvent.setup()
  render(<Fixture submit={submit} email />)
  await user.click(slots()[0]); await user.paste('123456')
  await screen.findByText('请输入邮箱串')
  expect(submit).not.toHaveBeenCalled()
  await user.type(screen.getByLabelText('邮箱串'), 'synthetic-token')
  await user.click(slots()[0]); await user.paste('654321')
  expect(submit).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '改用备用码' }))
  await user.type(screen.getByLabelText('备用码'), 'synthetic-backup-code')
  expect(submit).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: /^验\s*证$/ }))
  await waitFor(() => expect(submit).toHaveBeenCalledOnce())
})

test('填满后立即手动提交只发送一次，验证上下文更新才重新允许自动提交', async () => {
  const submit = vi.fn()
  function Policy({ revision }: { revision: string }) {
    return <Form onFinish={submit}><AccountStepUpFields enabled revision={revision} /><Button htmlType="submit">验证</Button></Form>
  }
  const view = render(<Policy revision="1" />)
  act(() => {
    fireEvent.change(slots()[0], { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /^验\s*证$/ }))
  })
  await waitFor(() => expect(submit).toHaveBeenCalledOnce())
  view.rerender(<Policy revision="2" />)
  expect(code()).toBe('')
  fireEvent.change(slots()[0], { target: { value: '654321' } })
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
})

test.each(['disabled', 'autoSubmit', 'method', 'unmount'] as const)('填满后进入 %s 状态取消排队的自动提交', async state => {
  const submit = vi.fn()
  const view = render(<Fixture submit={submit} />)
  act(() => {
    fireEvent.change(slots()[0], { target: { value: '123456' } })
    if (state === 'unmount') view.unmount()
    else if (state === 'method') fireEvent.click(screen.getByRole('button', { name: '改用备用码' }))
    else if (state === 'autoSubmit') view.rerender(<Fixture submit={submit} autoSubmit={false} />)
    else view.rerender(<Fixture submit={submit} disabled />)
  })
  await act(async () => { await Promise.resolve() })
  expect(submit).not.toHaveBeenCalled()
})

test('外部间距可通过验证字段配置，并传递到同一个数字格组件', () => {
  const view = render(<Form><AccountStepUpFields enabled gap={18} /></Form>)
  expect(screen.getByRole('group', { name: '六位验证码' })).toHaveStyle('--totp-gap: 18px')
  view.rerender(<Form><AccountStepUpFields enabled gap={10} /></Form>)
  expect(screen.getByRole('group', { name: '六位验证码' })).toHaveStyle('--totp-gap: 10px')
})
