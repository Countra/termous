import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentSetupClient } from '../../../app/data-runtime/api/gateways/agentSetupClient.ts'
import { decodeAgentDefaultModelStatus, type AgentDefaultModelStatus } from './agentDefaultModelStatus.ts'
import { useAgentDefaultModelStatus } from './useAgentDefaultModelStatus.ts'

const available: AgentDefaultModelStatus = { available: true, model_id: 'model-one', model_name: 'Default model', provider_name: 'Provider' }

describe('默认模型只读状态', () => {
  it('解码可用与不可用状态，拒绝未知原因和缺失身份', () => {
    expect(decodeAgentDefaultModelStatus(available)).toEqual(available)
    expect(decodeAgentDefaultModelStatus({ available: false, reason: 'not_configured' })).toEqual({ available: false, reason: 'not_configured' })
    for (const invalid of [null, {}, { available: true }, { ...available, model_name: '' },
      { available: false, reason: 'server-internal-code' }, { ...available, reason: 'not_configured' }]) {
      expect(() => decodeAgentDefaultModelStatus(invalid)).toThrow()
    }
  })

  it('API 只请求默认模型状态端点并传播取消信号', async () => {
    const controller = new AbortController()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(available), { status: 200 }))
    try {
      await expect(new AgentSetupClient().getDefaultModelStatus({ signal: controller.signal })).resolves.toEqual(available)
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/agent/default-model/status')
      expect(fetchMock.mock.calls[0]?.[1]?.method ?? 'GET').toBe('GET')
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('关闭时取消，重新打开读取最新模型并拒绝旧回执', async () => {
    let resolveOld!: (status: AgentDefaultModelStatus) => void
    const getStatus = vi.fn().mockImplementationOnce(() => new Promise<AgentDefaultModelStatus>((resolve) => { resolveOld = resolve }))
      .mockResolvedValue({ ...available, model_name: 'New model' })
    const view = renderHook(({ enabled }) => useAgentDefaultModelStatus(getStatus, enabled), { initialProps: { enabled: false } })
    expect(getStatus).not.toHaveBeenCalled()
    view.rerender({ enabled: true })
    await waitFor(() => expect(getStatus).toHaveBeenCalledOnce())
    const signal = getStatus.mock.calls[0]?.[0].signal as AbortSignal
    view.rerender({ enabled: false })
    expect(signal.aborted).toBe(true)
    view.rerender({ enabled: true })
    await waitFor(() => expect(view.result.current).toMatchObject({ status: 'ready', label: 'New model' }))
    await act(async () => { resolveOld(available) })
    expect(view.result.current.label).toBe('New model')
  })

  it('请求失败使用明确回退，刷新后可恢复且不展示内部错误', async () => {
    const getStatus = vi.fn().mockRejectedValueOnce(new Error('private backend detail')).mockResolvedValue(available)
    const view = renderHook(() => useAgentDefaultModelStatus(getStatus, true))
    await waitFor(() => expect(view.result.current).toMatchObject({ status: 'unavailable', reason: 'status_unavailable' }))
    act(() => view.result.current.refresh())
    await waitFor(() => expect(view.result.current).toMatchObject({ status: 'ready', label: 'Default model' }))
  })
})
