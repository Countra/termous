import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { AgentQueuedTurn } from '#entities/agent'
import type { AgentWorkspaceMessage } from './types.ts'

const historyLimit = 10

export function agentComposerInputHistory(messages: AgentWorkspaceMessage[], queuedTurns: AgentQueuedTurn[]) {
  const inputs: { text: string; createdAt: string }[] = []
  // 消息已按会话顺序排列，流式回复期间只需回看最近十条用户输入。
  for (let index = messages.length - 1; index >= 0 && inputs.length < historyLimit; index -= 1) {
    const message = messages[index]!
    if (message.role !== 'user') continue
    const text = message.parts.flatMap((part) => part.kind === 'text' ? [part.text] : []).join('\n')
    if (text.trim()) inputs.unshift({ text, createdAt: message.created_at })
  }
  for (const turn of queuedTurns) {
    // 已消费的队列项由用户消息提供，避免同一次输入重复出现。
    if (turn.state === 'queued' && turn.prompt.trim()) inputs.push({ text: turn.prompt, createdAt: turn.created_at })
  }
  return inputs.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-historyLimit).reverse().map(({ text }) => text)
}

interface HistoryNavigation {
  sessionKey: string
  entries: readonly string[]
  index: number
}

export function useAgentComposerHistory({ sessionKey, value, history, disabled, onChange }: {
  sessionKey: string
  value: string
  history: readonly string[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  const navigation = useRef<HistoryNavigation | null>(null)
  useEffect(() => { navigation.current = null }, [sessionKey, disabled])
  const reset = () => { navigation.current = null }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) reset()
      return
    }
    if (disabled || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || /[\r\n]/.test(value) || event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) {
      reset()
      return
    }
    let current = navigation.current
    if (current?.sessionKey !== sessionKey || current.entries[current.index] !== value) current = null
    if (!current) {
      reset()
      if (value !== '' || event.key !== 'ArrowUp' || history.length === 0) return
      // 回看期间固定这十条记录，避免新消息到达后上下键跳到不同输入。
      current = { sessionKey, entries: history.slice(0, historyLimit), index: -1 }
    }
    if (value && hasWrappedLines(event.currentTarget)) {
      reset()
      return
    }
    const index = Math.max(-1, Math.min(current.entries.length - 1, current.index + (event.key === 'ArrowUp' ? 1 : -1)))
    event.preventDefault()
    navigation.current = index < 0 ? null : { ...current, index }
    if (index !== current.index) onChange(index < 0 ? '' : current.entries[index]!)
  }
  return { onKeyDown, reset }
}

function hasWrappedLines(textarea: HTMLTextAreaElement) {
  const parent = textarea.parentElement
  const width = textarea.getBoundingClientRect().width
  if (!parent || width <= 0) return false
  const style = getComputedStyle(textarea)
  const lineHeight = Number.parseFloat(style.lineHeight)
  if (!Number.isFinite(lineHeight)) return false
  const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
  // 原输入框最少显示两行，用同宽隐藏副本测量实际折行，避免把空白高度误认为多行。
  const probe = textarea.cloneNode(false) as HTMLTextAreaElement
  probe.removeAttribute('id')
  probe.removeAttribute('name')
  probe.setAttribute('aria-hidden', 'true')
  probe.tabIndex = -1
  probe.value = textarea.value
  Object.assign(probe.style, {
    position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
    width: `${width}px`, boxSizing: 'border-box', height: '0px', minHeight: '0px', maxHeight: 'none', overflow: 'hidden',
  })
  try {
    parent.appendChild(probe)
    return probe.scrollHeight > lineHeight + padding + 1
  } finally {
    probe.remove()
  }
}
