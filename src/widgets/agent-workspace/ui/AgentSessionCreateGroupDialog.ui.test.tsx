import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentSessionCreateGroupDialog } from './AgentSessionCreateGroupDialog.tsx'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(cleanup)

describe('AgentSessionCreateGroupDialog', () => {
  it('使用 Unicode 字符上限，输入法确认不误提交，失败后保留名称重试', async () => {
    const onCreate = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(true)
    const onClose = vi.fn()
    render(<AgentSessionCreateGroupDialog open disabled={false} onCreate={onCreate} onClose={onClose} />)
    const input = screen.getByRole('textbox', { name: 'agent.sessions.groupName' })
    fireEvent.change(input, { target: { value: '😀'.repeat(65) } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCreate).not.toHaveBeenCalled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const validName = '😀'.repeat(64)
    fireEvent.change(input, { target: { value: validName } })
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 })
    expect(onCreate).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByText('agent.sessions.createGroupFailed')
    expect(input).toHaveValue(validName)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onCreate).toHaveBeenLastCalledWith(validName)
  })

  it('请求期间拒绝重复提交和取消，重新打开时清除旧草稿', async () => {
    let resolve!: (value: boolean) => void
    const onCreate = vi.fn(() => new Promise<boolean>((done) => { resolve = done }))
    const onClose = vi.fn()
    const view = render(<AgentSessionCreateGroupDialog open disabled={false} onCreate={onCreate} onClose={onClose} />)
    const input = screen.getByRole('textbox', { name: 'agent.sessions.groupName' })
    fireEvent.change(input, { target: { value: 'Ops' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCreate).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'app.cancel' })).toBeDisabled()
    resolve(true)
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    view.rerender(<AgentSessionCreateGroupDialog open={false} disabled={false} onCreate={onCreate} onClose={onClose} />)
    view.rerender(<AgentSessionCreateGroupDialog open disabled={false} onCreate={onCreate} onClose={onClose} />)
    expect(screen.getByRole('textbox', { name: 'agent.sessions.groupName' })).toHaveValue('')
  })
})
