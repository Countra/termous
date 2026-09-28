import { ConfigProvider } from 'antd'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RemoteRenameModal } from './RemoteRenameModal'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('重命名错误反馈', () => {
  it.each(['.', '..', '../elsewhere', 'folder/name', '/absolute', 'invalid\u0000name'])('拒绝把名称 %j 解释为路径', async (name) => {
    const onSubmit = vi.fn()
    render(<ConfigProvider theme={{ token: { motion: false } }}><RemoteRenameModal initialName="before" onSubmit={onSubmit} onClose={vi.fn()} /></ConfigProvider>)
    fireEvent.change(screen.getByRole('textbox', { name: 'files.rename' }), { target: { value: name } })
    fireEvent.click(screen.getByRole('button', { name: 'app.update' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('files.renameNameInvalid'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it.each([new Error(''), new Error('   '), null])('没有可读错误消息时显示统一失败提示：%j', async (cause) => {
    const onClose = vi.fn()
    render(<ConfigProvider theme={{ token: { motion: false } }}><RemoteRenameModal initialName="before" onSubmit={vi.fn().mockRejectedValue(cause)} onClose={onClose} /></ConfigProvider>)
    fireEvent.change(screen.getByRole('textbox', { name: 'files.rename' }), { target: { value: 'after' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.update' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('files.operationFailed'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('合法 POSIX 名称保留中文、空格、反斜杠和后缀', async () => {
    const name = '文档 副本\\01.txt'
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ConfigProvider theme={{ token: { motion: false } }}><RemoteRenameModal initialName="before" onSubmit={onSubmit} onClose={vi.fn()} /></ConfigProvider>)
    fireEvent.change(screen.getByRole('textbox', { name: 'files.rename' }), { target: { value: name } })
    fireEvent.click(screen.getByRole('button', { name: 'app.update' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(name))
  })

  it('同步改名失败保留名称，修改后清除错误并允许再次提交', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('目标路径“/同名文件夹”已存在文件夹')).mockResolvedValueOnce(undefined)
    const onClose = vi.fn()
    render(<ConfigProvider theme={{ token: { motion: false } }}><RemoteRenameModal initialName="原文件" confirmLabel="app.save" onSubmit={onSubmit} onClose={onClose} /></ConfigProvider>)
    const input = screen.getByRole('textbox', { name: 'files.rename' })
    fireEvent.change(input, { target: { value: '同名文件夹' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('目标路径“/同名文件夹”已存在文件夹'))
    expect(input).toHaveValue('同名文件夹')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '新名称' } })
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onSubmit).toHaveBeenLastCalledWith('新名称')
  })

  it('执行期间阻止重复提交和关闭，成功后只关闭一次', async () => {
    let finish!: () => void
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const onClose = vi.fn()
    render(<ConfigProvider theme={{ token: { motion: false } }}><RemoteRenameModal initialName="before" onSubmit={onSubmit} onClose={onClose} /></ConfigProvider>)
    const input = screen.getByRole('textbox', { name: 'files.rename' })
    fireEvent.change(input, { target: { value: 'after' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.update' }))
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    expect(input).toBeDisabled()
    expect(screen.getByRole('button', { name: 'app.cancel' })).toBeDisabled()
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => { finish() })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
