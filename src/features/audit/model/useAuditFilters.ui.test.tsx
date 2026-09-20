import { act, renderHook } from '@testing-library/react'
import type { CompositionEvent, KeyboardEvent } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuditFilters } from './useAuditFilters'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('审计筛选提交', () => {
  it('多个文本字段共用防抖，连续输入只提交最终组合', () => {
    const commit = vi.fn()
    const { result } = renderHook(() => useAuditFilters(commit))
    act(() => result.current.change('search', 'curl', false))
    act(() => vi.advanceTimersByTime(200))
    act(() => result.current.change('action', 'termous.commands.dispatch', false))
    act(() => vi.advanceTimersByTime(200))
    act(() => result.current.change('correlation_id', 'call-final', false))
    act(() => vi.advanceTimersByTime(299))
    expect(commit).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(commit).toHaveBeenCalledExactlyOnceWith({ search: 'curl', action: 'termous.commands.dispatch', correlation_id: 'call-final' })
  })

  it('选择范围不查询空关键词，有关键词时下拉合并草稿立即查询且不重复提交', () => {
    const commit = vi.fn()
    const { result } = renderHook(() => useAuditFilters(commit))
    act(() => result.current.change('search_field', 'command'))
    expect(commit).not.toHaveBeenCalled()
    act(() => result.current.change('search', 'systemctl restart', false))
    act(() => result.current.change('source', 'mcp'))
    expect(commit).toHaveBeenCalledExactlyOnceWith({ search: 'systemctl restart', search_field: 'command', source: 'mcp' })
    act(() => vi.advanceTimersByTime(1000))
    expect(commit).toHaveBeenCalledTimes(1)
    act(() => result.current.change('search', ' systemctl restart ', false))
    act(() => vi.advanceTimersByTime(400))
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('组合输入期间暂停，结束后防抖，回车只提交一次', () => {
    const commit = vi.fn()
    const { result } = renderHook(() => useAuditFilters(commit))
    act(() => result.current.change('search', 'pending', false))
    act(() => result.current.textInput('search').onCompositionStart())
    act(() => result.current.change('search', 'zhong', false))
    act(() => vi.advanceTimersByTime(1000))
    expect(commit).not.toHaveBeenCalled()
    act(() => result.current.textInput('search').onCompositionEnd({ currentTarget: { value: '中文_100%' } } as CompositionEvent<HTMLInputElement>))
    expect(commit).not.toHaveBeenCalled()
    act(() => result.current.textInput('search').onPressEnter({ nativeEvent: { isComposing: false } } as KeyboardEvent<HTMLInputElement>))
    expect(commit).toHaveBeenCalledExactlyOnceWith({ search: '中文_100%' })
    act(() => vi.advanceTimersByTime(1000))
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('清空保留其他条件，重置取消草稿且清除已提交条件', () => {
    const commit = vi.fn()
    const { result } = renderHook(() => useAuditFilters(commit))
    act(() => result.current.change('search_field', 'command'))
    act(() => result.current.change('search', 'curl', false))
    act(() => result.current.change('source', 'mcp'))
    act(() => result.current.change('search', ''))
    expect(commit).toHaveBeenLastCalledWith({ source: 'mcp' })
    act(() => result.current.change('action', 'pending-action', false))
    act(() => result.current.reset())
    expect(commit).toHaveBeenLastCalledWith({})
    expect(result.current.hasFilters).toBe(false)
    act(() => vi.advanceTimersByTime(1000))
    expect(commit).toHaveBeenCalledTimes(3)
  })

  it('卸载后不提交待执行的防抖查询', () => {
    const commit = vi.fn()
    const { result, unmount } = renderHook(() => useAuditFilters(commit))
    act(() => result.current.change('search', 'pending', false))
    unmount()
    act(() => vi.advanceTimersByTime(1000))
    expect(commit).not.toHaveBeenCalled()
  })

  it('重置尚未提交的范围与关键词也通知列表复位，并取消后续提交', () => {
    const commit = vi.fn()
    const { result } = renderHook(() => useAuditFilters(commit))
    act(() => result.current.change('search_field', 'command'))
    act(() => result.current.change('search', 'pending', false))
    expect(commit).not.toHaveBeenCalled()
    act(() => result.current.reset())
    expect(commit).toHaveBeenCalledExactlyOnceWith({})
    act(() => vi.advanceTimersByTime(1000))
    expect(commit).toHaveBeenCalledTimes(1)
  })
})
