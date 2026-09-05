import { useState } from 'react'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentQueuedTurn } from '#entities/agent'
import type { AgentWorkspaceMessage } from './types.ts'
import { agentComposerInputHistory, useAgentComposerHistory } from './useAgentComposerHistory.ts'

function Composer({ sessionKey = 'session-a', history = ['最新输入', '更早输入'], initialValue = '', disabled = false }: {
  sessionKey?: string
  history?: string[]
  initialValue?: string
  disabled?: boolean
}) {
  const [value, onChange] = useState(initialValue)
  const navigation = useAgentComposerHistory({ sessionKey, value, history, disabled, onChange })
  return <textarea aria-label="输入" value={value} onKeyDown={navigation.onKeyDown}
    onPointerDown={navigation.reset} onCompositionStart={navigation.reset}
    onChange={(event) => { navigation.reset(); onChange(event.target.value) }} />
}

function input() { return screen.getByRole('textbox', { name: '输入' }) as HTMLTextAreaElement }
function arrow(key: 'ArrowUp' | 'ArrowDown', extra: Record<string, unknown> = {}) {
  const event = createEvent.keyDown(input(), { key, ...extra })
  fireEvent(input(), event)
  return event
}

describe('输入历史方向键', () => {
  afterEach(() => vi.restoreAllMocks())

  it('从空草稿回看最多十条，向下回到空草稿并允许再次回看', () => {
    render(<Composer history={Array.from({ length: 12 }, (_, index) => `输入${index}`)} />)
    expect(arrow('ArrowDown').defaultPrevented).toBe(false)
    for (let index = 0; index < 10; index += 1) {
      expect(arrow('ArrowUp').defaultPrevented).toBe(true)
      expect(input()).toHaveValue(`输入${index}`)
    }
    arrow('ArrowUp')
    expect(input()).toHaveValue('输入9')
    for (let index = 8; index >= 0; index -= 1) {
      arrow('ArrowDown')
      expect(input()).toHaveValue(`输入${index}`)
    }
    arrow('ArrowDown')
    expect(input()).toHaveValue('')
    arrow('ArrowUp')
    expect(input()).toHaveValue('输入0')
  })

  it('已有草稿与已修改的历史文本只使用原生光标，清空后可重新回看', () => {
    render(<Composer initialValue="未发送草稿" />)
    expect(arrow('ArrowUp').defaultPrevented).toBe(false)
    expect(arrow('ArrowDown').defaultPrevented).toBe(false)
    expect(input()).toHaveValue('未发送草稿')
    fireEvent.change(input(), { target: { value: '' } })
    arrow('ArrowUp')
    fireEvent.change(input(), { target: { value: '最新输入，继续补充' } })
    expect(arrow('ArrowUp').defaultPrevented).toBe(false)
    expect(input()).toHaveValue('最新输入，继续补充')
  })

  it('历史回填为多行时，随后上下键不切换历史', () => {
    render(<Composer history={['第一行\n第二行', '更早输入']} />)
    arrow('ArrowUp')
    expect(input()).toHaveValue('第一行\n第二行')
    expect(arrow('ArrowUp').defaultPrevented).toBe(false)
    expect(arrow('ArrowDown').defaultPrevented).toBe(false)
  })

  it('按实际软换行退出历史，输入框最小两行高度不影响单行回看', () => {
    render(<Composer />)
    input().style.lineHeight = '20px'
    input().style.padding = '4px'
    vi.spyOn(input(), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 320, 48))
    const measuredHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(48)
    arrow('ArrowUp')
    expect(arrow('ArrowUp').defaultPrevented).toBe(false)
    expect(input()).toHaveValue('最新输入')
    expect(document.querySelectorAll('textarea')).toHaveLength(1)

    fireEvent.change(input(), { target: { value: '' } })
    arrow('ArrowUp')
    measuredHeight.mockImplementation(function (this: HTMLElement) {
      return this === input() ? 48 : 28
    })
    expect(arrow('ArrowUp').defaultPrevented).toBe(true)
    expect(input()).toHaveValue('更早输入')
    expect(document.querySelectorAll('textarea')).toHaveLength(1)
  })

  it.each(['ArrowLeft', 'ArrowRight', 'Home', 'End'])('用 %s 定位光标后退出历史回看', (key) => {
    render(<Composer />)
    arrow('ArrowUp')
    fireEvent.keyDown(input(), { key })
    expect(arrow('ArrowUp').defaultPrevented).toBe(false)
    expect(input()).toHaveValue('最新输入')
  })

  it('点击定位或选中文字后不覆盖历史文本', () => {
    render(<Composer />)
    arrow('ArrowUp')
    fireEvent.pointerDown(input())
    expect(arrow('ArrowDown').defaultPrevented).toBe(false)
    fireEvent.change(input(), { target: { value: '' } })
    arrow('ArrowUp')
    input().setSelectionRange(0, 2)
    expect(arrow('ArrowUp').defaultPrevented).toBe(false)
    expect(input()).toHaveValue('最新输入')
  })

  it.each([{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }])('不拦截输入法或修饰键 %j', (extra) => {
    render(<Composer />)
    expect(arrow('ArrowUp', extra).defaultPrevented).toBe(false)
    expect(input()).toHaveValue('')
  })

  it('开始组合输入后即使尚未改字，也不继续切换历史', () => {
    render(<Composer />)
    arrow('ArrowUp')
    fireEvent.compositionStart(input())
    fireEvent.compositionEnd(input())
    expect(arrow('ArrowDown').defaultPrevented).toBe(false)
  })

  it('回看期间固定历史快照，回到空草稿后再接收新历史', () => {
    const view = render(<Composer />)
    arrow('ArrowUp')
    view.rerender(<Composer history={['新增输入', '最新输入', '更早输入']} />)
    arrow('ArrowUp')
    expect(input()).toHaveValue('更早输入')
    arrow('ArrowDown')
    arrow('ArrowDown')
    arrow('ArrowUp')
    expect(input()).toHaveValue('新增输入')
  })

  it('切换会话后再切回，不能沿用原来的历史游标', () => {
    const view = render(<Composer />)
    arrow('ArrowUp')
    view.rerender(<Composer sessionKey="session-b" />)
    view.rerender(<Composer sessionKey="session-a" />)
    expect(arrow('ArrowUp').defaultPrevented).toBe(false)
    expect(input()).toHaveValue('最新输入')
  })

  it('进入和退出队列编辑后清除历史游标，空队列编辑也不回填', () => {
    const view = render(<Composer />)
    arrow('ArrowUp')
    view.rerender(<Composer disabled />)
    expect(arrow('ArrowUp').defaultPrevented).toBe(false)
    view.rerender(<Composer />)
    expect(arrow('ArrowDown').defaultPrevented).toBe(false)
    fireEvent.change(input(), { target: { value: '' } })
    view.rerender(<Composer disabled />)
    expect(arrow('ArrowUp').defaultPrevented).toBe(false)
  })

  it('没有历史时不拦截方向键', () => {
    render(<Composer history={[]} />)
    expect(arrow('ArrowUp').defaultPrevented).toBe(false)
  })
})

describe('输入历史来源', () => {
  it('仅提取用户文本与未消费队列，按提交时间回看十条且不修改来源', () => {
    const messages = Array.from({ length: 12 }, (_, index): AgentWorkspaceMessage => ({
      id: `message-${index}`, role: 'user', status: 'completed', attachments: [],
      created_at: `2026-09-05T01:00:${String(index).padStart(2, '0')}Z`,
      parts: [{ id: `text-${index}`, kind: 'text', text: `输入${index}` }],
    }))
    messages.push({ ...messages[0]!, id: 'assistant', role: 'assistant', parts: [{ id: 'response', kind: 'text', text: '模型回复' }] })
    const queue = ['queued', 'dispatched', 'cancelled'].map((state, index) => ({
      id: `queue-${index}`, state, prompt: `队列${index}`, created_at: '2026-09-05T01:00:30Z',
    } as AgentQueuedTurn))
    expect(agentComposerInputHistory(messages, queue)).toEqual(['队列0', ...Array.from({ length: 9 }, (_, index) => `输入${11 - index}`)])
    expect(messages[0]?.id).toBe('message-0')
  })

  it('过滤空文本，保留原文的空格与多行，不取附件及推理内容', () => {
    const message: AgentWorkspaceMessage = {
      id: 'message', role: 'user', status: 'completed', attachments: [], created_at: '2026-09-05T01:00:00Z',
      parts: [{ id: 'text-a', kind: 'text', text: ' 原始输入 ' }, { id: 'text-b', kind: 'text', text: '第二行' },
        { id: 'reasoning', kind: 'reasoning', text: '不应回填', streaming: false }],
    }
    expect(agentComposerInputHistory([message, { ...message, id: 'empty', parts: [{ id: 'blank', kind: 'text', text: '  ' }] }], [])).toEqual([' 原始输入 \n第二行'])
  })
})
