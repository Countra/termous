import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App as AntdApp } from 'antd'
import { beforeEach, expect, it, vi } from 'vitest'
import type { SkillInstallBridge, SkillInstallPlan, SkillInstallResponse, SkillInstallResult } from '#common/contracts'
import { McpSkillInstallButton } from './McpSkillInstallButton'

const state = vi.hoisted(() => ({ gateway: null as SkillInstallBridge | null }))
vi.mock('../../api/skillInstallGateway', () => ({ getSkillInstallGateway: () => state.gateway }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const plan: SkillInstallPlan = { id: 'plan-1', client: 'codex', base_directory: 'D:\\Project', target_directory: 'D:\\Project\\.agents\\skills', skills: [{ name: 'termous-files', exists: false }, { name: 'termous-remote-ops', exists: true }] }

beforeEach(() => {
  state.gateway = {
    selectDirectory: vi.fn().mockResolvedValue({ ok: true, value: plan }),
    install: vi.fn().mockResolvedValue({ ok: true, value: { target_directory: plan.target_directory, items: [{ name: 'termous-files', status: 'installed' }, { name: 'termous-remote-ops', status: 'skipped' }] } }),
  }
})

async function openDialog() {
  render(<AntdApp><McpSkillInstallButton /></AntdApp>)
  fireEvent.click(screen.getByRole('button', { name: 'settings.mcp.skills.install' }))
  return within(await screen.findByRole('dialog'))
}

it('预览最终目录与冲突，默认跳过且安装完成后不可重放旧计划', async () => {
  const modal = await openDialog()
  expect(modal.getByRole('button', { name: 'settings.mcp.skills.install' })).toBeDisabled()
  fireEvent.click(modal.getByRole('button', { name: 'settings.mcp.skills.choose' }))
  expect(await modal.findByText(plan.target_directory)).toBeInTheDocument()
  expect(state.gateway!.selectDirectory).toHaveBeenCalledWith('codex')
  expect(modal.getByRole('checkbox')).not.toBeChecked()
  fireEvent.click(modal.getByRole('button', { name: 'settings.mcp.skills.install' }))
  await modal.findByText('settings.mcp.skills.finished')
  expect(state.gateway!.install).toHaveBeenCalledWith({ plan_id: plan.id, policy: 'skip' })
  expect(modal.getByRole('button', { name: 'settings.mcp.skills.install' })).toBeDisabled()
  fireEvent.click(modal.getByRole('button', { name: 'app.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('显式替换才能覆盖，执行中阻止重复点击及关闭，部分失败展示恢复路径', async () => {
  let resolve!: (result: SkillInstallResponse<SkillInstallResult>) => void
  state.gateway!.install = vi.fn(() => new Promise<SkillInstallResponse<SkillInstallResult>>((done) => { resolve = done }))
  const modal = await openDialog()
  fireEvent.click(modal.getByRole('button', { name: 'settings.mcp.skills.choose' }))
  await modal.findByText(plan.target_directory)
  fireEvent.click(modal.getByRole('checkbox'))
  const button = modal.getByRole('button', { name: 'settings.mcp.skills.install' })
  fireEvent.click(button)
  fireEvent.click(button)
  expect(state.gateway!.install).toHaveBeenCalledTimes(1)
  expect(state.gateway!.install).toHaveBeenCalledWith({ plan_id: plan.id, policy: 'replace' })
  expect(modal.getByRole('button', { name: 'app.cancel' })).toBeDisabled()
  await act(async () => resolve({ ok: true, value: { target_directory: plan.target_directory, items: [{ name: 'termous-files', status: 'failed', error: 'permission_denied', recovery_path: 'D:\\recovery' }] } }))
  expect(modal.getByText('settings.mcp.skills.partial')).toBeInTheDocument()
  expect(modal.getByText('D:\\recovery')).toBeInTheDocument()
  expect(modal.getByText('settings.mcp.skills.errors.permission_denied')).toBeInTheDocument()
})

it('切换客户端清除旧目录计划，取消选择不发起安装，异常允许重新选择', async () => {
  const modal = await openDialog()
  fireEvent.click(modal.getByRole('button', { name: 'settings.mcp.skills.choose' }))
  await modal.findByText(plan.target_directory)
  fireEvent.mouseDown(modal.getByRole('combobox'))
  fireEvent.click(await screen.findByText('Claude Code', { selector: '.select-option-content > span' }))
  expect(modal.queryByText(plan.target_directory)).not.toBeInTheDocument()
  expect(modal.getByRole('button', { name: 'settings.mcp.skills.install' })).toBeDisabled()
  vi.mocked(state.gateway!.selectDirectory).mockResolvedValueOnce({ ok: true, value: null })
  fireEvent.click(modal.getByRole('button', { name: 'settings.mcp.skills.choose' }))
  await waitFor(() => expect(state.gateway!.selectDirectory).toHaveBeenLastCalledWith('claude-code'))
  expect(state.gateway!.install).not.toHaveBeenCalled()
  await act(async () => {})
  vi.mocked(state.gateway!.selectDirectory).mockRejectedValueOnce(new Error('ipc failure'))
  fireEvent.click(modal.getByRole('button', { name: 'settings.mcp.skills.choose' }))
  expect(await modal.findByText('settings.mcp.skills.errors.io_error')).toBeInTheDocument()
  expect(modal.getByRole('button', { name: 'settings.mcp.skills.choose' })).toBeEnabled()
})

it('浏览器无桌面桥接时通过提示说明限制并禁用安装', async () => {
  state.gateway = null
  render(<AntdApp><McpSkillInstallButton /></AntdApp>)
  const button = screen.getByRole('button', { name: 'settings.mcp.skills.install' })
  expect(button).toBeDisabled()
  fireEvent.mouseEnter(button.parentElement!)
  expect(await screen.findByText('settings.mcp.skills.desktopOnly')).toBeInTheDocument()
})

it('安装请求失败后保留本次目标目录，旧计划不可重放', async () => {
  vi.mocked(state.gateway!.install).mockResolvedValueOnce({ ok: false, error: 'permission_denied' })
  const modal = await openDialog()
  fireEvent.click(modal.getByRole('button', { name: 'settings.mcp.skills.choose' }))
  await modal.findByText(plan.target_directory)
  fireEvent.click(modal.getByRole('button', { name: 'settings.mcp.skills.install' }))
  await modal.findByText('settings.mcp.skills.errors.permission_denied')
  expect(modal.getByText(plan.target_directory)).toBeInTheDocument()
  expect(modal.getByRole('button', { name: 'settings.mcp.skills.install' })).toBeDisabled()
})

it('重新选择目录失败时清除上一次的成功提示和目标路径', async () => {
  const modal = await openDialog()
  fireEvent.click(modal.getByRole('button', { name: 'settings.mcp.skills.choose' }))
  await modal.findByText(plan.target_directory)
  fireEvent.click(modal.getByRole('button', { name: 'settings.mcp.skills.install' }))
  await modal.findByText('settings.mcp.skills.finished')
  vi.mocked(state.gateway!.selectDirectory).mockResolvedValueOnce({ ok: false, error: 'unsafe_path' })
  fireEvent.click(modal.getByRole('button', { name: 'settings.mcp.skills.choose' }))
  await modal.findByText('settings.mcp.skills.errors.unsafe_path')
  expect(modal.queryByRole('status')).not.toBeInTheDocument()
  expect(modal.queryByText(plan.target_directory)).not.toBeInTheDocument()
})
