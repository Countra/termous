import { SettingsModuleStore } from '#entities/settings'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AuditSettings as Settings } from '#entities/audit'
import { changeLanguage } from '#shared/i18n'
import type { AuditSettingsGateway } from '../../api/auditSettingsGateway'
import { AuditSettings } from './AuditSettings'

beforeAll(async () => { await changeLanguage('zh-CN') })
const initial: Settings = { enabled: true, retention_days: 90, max_records: 0 }
interface AuditTestAPI {
  auditSettings(signal?: AbortSignal): Promise<Settings>
  updateAuditSettings(patch: Partial<Settings>, signal?: AbortSignal): Promise<Settings>
}
function gateway(overrides: Partial<AuditTestAPI> = {}): AuditSettingsGateway & AuditTestAPI {
  const api: AuditTestAPI = {
    auditSettings: vi.fn(async () => initial),
    updateAuditSettings: vi.fn(async (patch) => ({ ...initial, ...patch })),
    ...overrides,
  }
  let revision = 0
  const store = new SettingsModuleStore({
    read: async (_id, signal) => ({ id: 'audit', schema_version: 1, revision: ++revision, value: { ...await api.auditSettings(signal) }, state: { status: 'applied' } }),
    update: async (_id, input, signal) => ({ id: 'audit', schema_version: 1, revision: ++revision, value: { ...await api.updateAuditSettings(input.patch, signal) }, state: { status: 'applied' } }),
  })
  return { ...api, getModule: (id) => store.snapshot(id), readModule: (id, signal) => store.read(id, signal), updateModule: (id, patch, options) => store.update(id, patch, options), subscribeSettings: store.subscribe }
}

describe('审计设置页', () => {
  it('仅提交变更字段，保存后留在设置页并显示生效状态', async () => {
    const api = gateway()
    render(<AuditSettings gateway={api} disabled={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const toggle = await screen.findByRole('switch', { name: '启用审计记录' })
    expect(toggle).toBeChecked()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    fireEvent.click(toggle)
    const records = screen.getByRole('spinbutton', { name: '最多保留条数' })
    expect(records).toBeEnabled()
    fireEvent.change(records, { target: { value: '1000' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('已保存')
    expect(api.updateAuditSettings).toHaveBeenCalledWith({ enabled: false, max_records: 1000 }, expect.any(AbortSignal))
    expect(toggle).not.toBeChecked()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    fireEvent.change(records, { target: { value: '2000' } })
    expect(screen.queryByText('已保存')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })

  it('加载失败不展示默认值冒充当前策略，重试后校验输入', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(initial)
    render(<AuditSettings gateway={gateway({ auditSettings: read })} disabled={false} />)
    await screen.findByText('无法读取审计设置，请重试')
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }))
    const input = await screen.findByRole('spinbutton', { name: '最多保留条数' })
    for (const value of ['999', '']) {
      fireEvent.change(input, { target: { value } })
      expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    }
    fireEvent.change(input, { target: { value: '1000' } })
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    fireEvent.change(screen.getByRole('spinbutton', { name: '最长保留天数' }), { target: { value: '' } })
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('保存失败保留草稿，重试成功前不显示已保存', async () => {
    const update = vi.fn().mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValue({ ...initial, enabled: false })
    render(<AuditSettings gateway={gateway({ updateAuditSettings: update })} disabled={false} />)
    fireEvent.click(await screen.findByRole('switch', { name: '启用审计记录' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('保存失败，修改尚未确认，请重试')
    expect(screen.getByRole('switch')).not.toBeChecked()
    expect(screen.queryByText('已保存')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('已保存')
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('保存防重复，切换 Core 会取消旧请求且不会解除新请求保护', async () => {
    let finishOld: (value: Settings) => void = () => undefined
    let finishNew: (value: Settings) => void = () => undefined
    const old = gateway({ updateAuditSettings: vi.fn(() => new Promise<Settings>((resolve) => { finishOld = resolve })) })
    const next = gateway({ updateAuditSettings: vi.fn(() => new Promise<Settings>((resolve) => { finishNew = resolve })) })
    const view = render(<AuditSettings gateway={old} disabled={false} />)
    fireEvent.click(await screen.findByRole('switch', { name: '启用审计记录' }))
    const save = screen.getByRole('button', { name: '保存' })
    fireEvent.click(save); fireEvent.click(save)
    await waitFor(() => expect(old.updateAuditSettings).toHaveBeenCalledOnce())
    const signal = vi.mocked(old.updateAuditSettings).mock.calls[0][1]
    view.rerender(<AuditSettings gateway={next} disabled={false} />)
    expect(signal?.aborted).toBe(true)
    fireEvent.click(await screen.findByRole('switch', { name: '启用审计记录' }))
    fireEvent.click(save)
    await waitFor(() => expect(next.updateAuditSettings).toHaveBeenCalledOnce())
    await act(async () => { finishOld({ ...initial, retention_days: 7 }) })
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByRole('spinbutton', { name: '最长保留天数' })).toHaveValue('90')
    expect(screen.queryByText('已保存')).not.toBeInTheDocument()
    await act(async () => { finishNew({ ...initial, enabled: false }) })
    await screen.findByText('已保存')
    expect(screen.getByRole('switch')).toBeEnabled()
    view.unmount()
    expect(vi.mocked(next.auditSettings).mock.calls[0][0]?.aborted).toBe(true)
  })

  it('全局忙碌状态禁止保存，切换语言保留草稿', async () => {
    const api = gateway()
    const view = render(<AuditSettings gateway={api} disabled={false} />)
    const input = await screen.findByRole('spinbutton', { name: '最长保留天数' })
    fireEvent.change(input, { target: { value: '30' } })
    view.rerender(<AuditSettings gateway={api} disabled />)
    expect(input).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    try {
      await act(async () => { await changeLanguage('en-US') })
      await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Maximum retention days' })).toHaveValue('30'))
      expect(api.auditSettings).toHaveBeenCalledOnce()
      expect(api.updateAuditSettings).not.toHaveBeenCalled()
    } finally {
      await act(async () => { await changeLanguage('zh-CN') })
    }
  })
})
