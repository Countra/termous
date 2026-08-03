import { Tooltip } from 'antd'
import { Check, Code2, Command, Folder, History, Sparkles, SquareTerminal } from 'lucide-react'
import {
  useEffect,
  useRef,
  type ComponentType,
  type MouseEvent,
  type SVGProps,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { CompletionItem, ThemeMode } from '../../types/domain'
import { isExactCompletionItem, splitCompletionLabel } from './completionModel'
import {
  TERMINAL_COMPLETION_POPUP_WIDTH,
  type TerminalCompletionPopupPosition,
} from './terminalCompletionPosition'
import '../../styles/terminal-completion.css'

type CompletionIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>

const sourceIcons: Partial<Record<string, CompletionIcon>> = {
  native: SquareTerminal,
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
  themeMode: ThemeMode
  onSelectedIndexChange: (index: number) => void
  onAccept: (item: CompletionItem, index: number) => void
}

export function TerminalCompletionPopup({
  id = 'terminal-completion-listbox',
  open,
  items,
  selectedIndex,
  position,
  themeMode,
  onSelectedIndexChange,
  onAccept,
}: TerminalCompletionPopupProps) {
  const { t, i18n } = useTranslation()
  const popupRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (!open || selectedIndex < 0 || selectedIndex >= items.length) {
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
  }, [open, selectedIndex, items.length])

  if (!open || !position || items.length === 0) {
    return null
  }

  const activeDescendant = selectedIndex >= 0 && selectedIndex < items.length
    ? `${id}-option-${selectedIndex}`
    : undefined

  return (
    <div
      className={`terminal-completion-popup terminal-completion-theme-${themeMode}`}
      data-placement={position.placement}
      style={{
        left: position.left,
        top: position.top,
        width: Math.min(TERMINAL_COMPLETION_POPUP_WIDTH, position.maxWidth),
        maxHeight: position.maxHeight,
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div
        ref={popupRef}
        id={id}
        className="terminal-completion-options"
        role="listbox"
        aria-label={t('terminal.completion.label')}
        aria-activedescendant={activeDescendant}
        aria-describedby={`${id}-shortcuts`}
      >
        {items.map((item, index) => {
          const Icon = sourceIcons[item.source] ?? Sparkles
          const selected = index === selectedIndex
          const exact = isExactCompletionItem(item)
          const label = splitCompletionLabel(item)
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
              className={`terminal-completion-option ${selected ? 'is-selected' : ''} ${exact ? 'is-exact' : ''}`}
              type="button"
              role="option"
              aria-selected={selected}
              aria-posinset={index + 1}
              aria-setsize={items.length}
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
                <span className="terminal-completion-option-label">
                  {label.entered ? (
                    <span className="terminal-completion-option-entered">{label.entered}</span>
                  ) : null}
                  {label.suggestion ? (
                    <span className="terminal-completion-option-suggestion">{label.suggestion}</span>
                  ) : null}
                </span>
                {item.detail ? (
                  <span className="terminal-completion-option-detail">{item.detail}</span>
                ) : null}
              </span>
              <span className="terminal-completion-option-meta">
                <span className="terminal-completion-option-source">{sourceSummary}</span>
                {exact ? (
                  <span className="terminal-completion-option-exact">
                    <Check size={10} strokeWidth={2.5} aria-hidden="true" />
                    {t('terminal.completion.exact')}
                  </span>
                ) : null}
              </span>
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
              classNames={{
                root: `termous-tooltip terminal-completion-tooltip terminal-completion-theme-${themeMode}`,
              }}
            >
              {option}
            </Tooltip>
          )
        })}
      </div>
      <div id={`${id}-shortcuts`} className="terminal-completion-shortcuts">
        <span className="terminal-completion-shortcut">
          <kbd>↑↓</kbd>
          <span>{t('terminal.completion.shortcuts.navigate')}</span>
        </span>
        <span className="terminal-completion-shortcut">
          <kbd>Enter</kbd>
          <span>{t('terminal.completion.shortcuts.select')}</span>
        </span>
      </div>
    </div>
  )
}
