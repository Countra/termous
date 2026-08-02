import { Tooltip } from 'antd'
import { Code2, Command, Folder, History, Sparkles } from 'lucide-react'
import {
  useEffect,
  useRef,
  type ComponentType,
  type MouseEvent,
  type SVGProps,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { CompletionItem } from '../../types/domain'
import {
  TERMINAL_COMPLETION_MAX_ITEMS,
  TERMINAL_COMPLETION_POPUP_WIDTH,
  type TerminalCompletionPopupPosition,
} from './terminalCompletionPosition'
import '../../styles/terminal-completion.css'

type CompletionIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>

const sourceIcons: Partial<Record<string, CompletionIcon>> = {
  alias: Command,
  snippet: Code2,
  history: History,
  directory: Folder,
}

export interface TerminalCompletionPopupProps {
  id?: string
  open: boolean
  items: readonly CompletionItem[]
  selectedIndex: number
  position: TerminalCompletionPopupPosition | null
  onSelectedIndexChange: (index: number) => void
  onAccept: (item: CompletionItem, index: number) => void
}

export function TerminalCompletionPopup({
  id = 'terminal-completion-listbox',
  open,
  items,
  selectedIndex,
  position,
  onSelectedIndexChange,
  onAccept,
}: TerminalCompletionPopupProps) {
  const { t, i18n } = useTranslation()
  const popupRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const visibleItems = items.slice(0, TERMINAL_COMPLETION_MAX_ITEMS)

  useEffect(() => {
    if (!open || selectedIndex < 0 || selectedIndex >= visibleItems.length) {
      return
    }
    const popup = popupRef.current
    const item = itemRefs.current[selectedIndex]
    if (!popup || !item) {
      return
    }
    if (item.offsetTop < popup.scrollTop) {
      popup.scrollTop = item.offsetTop
    } else if (item.offsetTop + item.offsetHeight > popup.scrollTop + popup.clientHeight) {
      popup.scrollTop = item.offsetTop + item.offsetHeight - popup.clientHeight
    }
  }, [open, selectedIndex, visibleItems.length])

  if (!open || !position || visibleItems.length === 0) {
    return null
  }

  const activeDescendant = selectedIndex >= 0 && selectedIndex < visibleItems.length
    ? `${id}-option-${selectedIndex}`
    : undefined

  return (
    <div
      ref={popupRef}
      id={id}
      className="terminal-completion-popup"
      data-placement={position.placement}
      role="listbox"
      aria-label={t('terminal.completion.label')}
      aria-activedescendant={activeDescendant}
      style={{
        left: position.left,
        top: position.top,
        width: Math.min(TERMINAL_COMPLETION_POPUP_WIDTH, position.maxWidth),
        maxHeight: position.maxHeight,
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {visibleItems.map((item, index) => {
        const Icon = sourceIcons[item.source] ?? Sparkles
        const selected = index === selectedIndex
        const sources = item.sources.length > 0 ? item.sources : [item.source]
        const sourceSummary = sources
          .map((source) => {
            const key = `terminal.completion.sources.${source}`
            return i18n.exists(key) ? t(key) : t('terminal.completion.sources.other')
          })
          .join(' · ')
        const showTooltip = Array.from(item.label).length > 28
          || Array.from(item.detail ?? '').length > 44
          || sources.length > 1
        const option = (
          <button
            ref={(element) => {
              itemRefs.current[index] = element
            }}
            id={`${id}-option-${index}`}
            key={item.id}
            className={`terminal-completion-option ${selected ? 'is-selected' : ''}`}
            type="button"
            role="option"
            aria-selected={selected}
            aria-posinset={index + 1}
            aria-setsize={visibleItems.length}
            tabIndex={-1}
            onMouseEnter={() => {
              if (!selected) {
                onSelectedIndexChange(index)
              }
            }}
            onMouseDown={(event: MouseEvent<HTMLButtonElement>) => {
              event.preventDefault()
              event.stopPropagation()
              if (event.button !== 0) {
                return
              }
              onSelectedIndexChange(index)
              onAccept(item, index)
            }}
          >
            <Icon className="terminal-completion-option-icon" size={16} aria-hidden="true" />
            <span className="terminal-completion-option-content">
              <span className="terminal-completion-option-label">{item.label}</span>
              {item.detail ? (
                <span className="terminal-completion-option-detail">{item.detail}</span>
              ) : null}
            </span>
            <span className="terminal-completion-option-source">{sourceSummary}</span>
          </button>
        )

        if (!showTooltip) {
          return option
        }
        return (
          <Tooltip
            key={item.id}
            title={(
              <span className="terminal-completion-tooltip-content">
                <strong>{item.label}</strong>
                {item.detail ? <span>{item.detail}</span> : null}
                <small>{sourceSummary}</small>
              </span>
            )}
            placement="right"
            mouseEnterDelay={0.4}
            destroyOnHidden
            classNames={{ root: 'termous-tooltip terminal-completion-tooltip' }}
          >
            {option}
          </Tooltip>
        )
      })}
    </div>
  )
}
