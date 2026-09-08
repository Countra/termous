import { useLayoutEffect, useRef, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal } from 'lucide-react'
import type { TerminalAICompletionResult } from '#common/contracts'
import styles from './TerminalAiCompletionPanel.module.scss'

export type TerminalAiCompletionCandidate = Pick<Extract<TerminalAICompletionResult, { status: 'completed' }>, 'command' | 'description'> & {
  requestId: string
  model?: { id: string; name: string }
}

interface TerminalAiCompletionListProps {
  id: string
  listRef: RefObject<HTMLDivElement | null>
  viewportRef: RefObject<HTMLDivElement | null>
  results: readonly TerminalAiCompletionCandidate[]
  selectedResultId: string | null
  onSelectResult: (requestId: string) => void
  canAppend: boolean
  onAppend: () => void
}

export function TerminalAiCompletionList({
  id, listRef, viewportRef, results, selectedResultId, onSelectResult, canAppend, onAppend,
}: TerminalAiCompletionListProps) {
  const { t } = useTranslation()
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const selectedIndex = results.findIndex((result) => result.requestId === selectedResultId)

  useLayoutEffect(() => {
    const list = listRef.current
    const item = selectedResultId ? itemRefs.current.get(selectedResultId) : undefined
    if (!list || !item || list.clientHeight <= 0) return
    // 只滚动候选列表；超高命令先展示开头，用户可继续滚动检查完整内容。
    if (item.offsetTop < list.scrollTop || item.offsetHeight > list.clientHeight) {
      list.scrollTop = item.offsetTop
    } else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight
    }
    const viewport = viewportRef.current
    if (!viewport || viewport.clientHeight <= 0) return
    // 短面板还可能由外层裁切，只调整面板自己的滚动区，不移动终端历史。
    const viewportRect = viewport.getBoundingClientRect()
    const visibleTop = Math.max(item.getBoundingClientRect().top, list.getBoundingClientRect().top)
    const visibleHeight = Math.min(item.offsetHeight, list.clientHeight)
    if (visibleTop < viewportRect.top || visibleHeight > viewport.clientHeight) {
      viewport.scrollTop += visibleTop - viewportRect.top
    } else if (visibleTop + visibleHeight > viewportRect.bottom) {
      viewport.scrollTop += visibleTop + visibleHeight - viewportRect.bottom
    }
  }, [listRef, viewportRef, results, selectedResultId])

  return (
    <div
      ref={listRef}
      id={id}
      className={styles['candidate-list']}
      role="listbox"
      tabIndex={0}
      aria-label={t('terminal.aiCompletion.candidatesLabel')}
      title={t('terminal.aiCompletion.listHint')}
      aria-describedby={`${id}-hint`}
      aria-activedescendant={selectedIndex >= 0 ? `${id}-option-${selectedIndex}` : undefined}
      onFocus={(event) => {
        if (event.target === event.currentTarget && results.length > 0) {
          onSelectResult(results[Math.max(0, selectedIndex)].requestId)
        }
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229
          || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
        if (event.key === 'Enter') {
          event.preventDefault()
          if (canAppend) onAppend()
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const nextIndex = selectedIndex < 0 ? 0 : Math.max(0, Math.min(results.length - 1,
            selectedIndex + (event.key === 'ArrowDown' ? 1 : -1)))
          if (results[nextIndex]) onSelectResult(results[nextIndex].requestId)
        }
      }}
    >
      {results.map((result, index) => (
        <button
          key={result.requestId}
          ref={(element) => {
            if (element) itemRefs.current.set(result.requestId, element)
            else itemRefs.current.delete(result.requestId)
          }}
          id={`${id}-option-${index}`}
          type="button"
          role="option"
          tabIndex={-1}
          aria-selected={result.requestId === selectedResultId}
          className={styles.candidate}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            listRef.current?.focus()
            onSelectResult(result.requestId)
          }}
          onDoubleClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (canAppend && result.requestId === selectedResultId) onAppend()
          }}
        >
          <Terminal className={styles['candidate-icon']} size={13} aria-hidden="true" />
          <pre className={styles.command}>{result.command}</pre>
        </button>
      ))}
    </div>
  )
}
