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
import type { AppTheme as ThemeMode } from '#common/contracts'
import type { CompletionItem } from '#entities/session'
import { useShortcutRuntime } from '#entities/shortcuts'
import { isExactCompletionItem, splitCompletionLabel } from '../model/completionModel'
import {
  TERMINAL_COMPLETION_POPUP_WIDTH,
  type TerminalCompletionPopupPosition,
} from '../model/terminalCompletionPosition'
import styles from './TerminalCompletionPopup.module.scss'

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
  const { labels: shortcutLabels } = useShortcutRuntime()
  const navigationShortcuts = [
    shortcutLabels.get('terminal.completion.previous')?.[0],
    shortcutLabels.get('terminal.completion.next')?.[0],
  ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
  const acceptShortcut = shortcutLabels.get('terminal.completion.accept')?.[0]
  const showShortcutFooter = navigationShortcuts.length > 0 || Boolean(acceptShortcut)
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
      className={`${styles['terminal-completion-popup']} ${styles[`terminal-completion-theme-${themeMode}`]} ${
        showShortcutFooter ? styles['has-shortcut-footer'] : ''
      }`}
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
        className={styles['terminal-completion-options']}
        role="listbox"
        aria-label={t('terminal.completion.label')}
        aria-activedescendant={activeDescendant}
        aria-describedby={showShortcutFooter ? `${id}-shortcuts` : undefined}
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
              className={`${styles['terminal-completion-option']} ${selected ? styles['is-selected'] : ''} ${exact ? styles['is-exact'] : ''}`}
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
              <Icon className={styles['terminal-completion-option-icon']} size={16} aria-hidden="true" />
              <span className={styles['terminal-completion-option-content']}>
                <span className={styles['terminal-completion-option-label']}>
                  {label.entered ? (
                    <span className={styles['terminal-completion-option-entered']}>{label.entered}</span>
                  ) : null}
                  {label.suggestion ? (
                    <span className={styles['terminal-completion-option-suggestion']}>{label.suggestion}</span>
                  ) : null}
                </span>
                {item.detail ? (
                  <span className={styles['terminal-completion-option-detail']}>{item.detail}</span>
                ) : null}
              </span>
              <span className={styles['terminal-completion-option-meta']}>
                <span className={styles['terminal-completion-option-source']}>{sourceSummary}</span>
                {exact ? (
                  <span className={styles['terminal-completion-option-exact']}>
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
                <span className={styles['terminal-completion-tooltip-content']}>
                  <strong>{item.label}</strong>
                  {item.detail ? <span>{item.detail}</span> : null}
                  <small>{sourceSummary}</small>
                </span>
              )}
              placement="right"
              mouseEnterDelay={0.4}
              destroyOnHidden
              classNames={{
                root: `termous-tooltip ${styles['terminal-completion-tooltip']} ${styles[`terminal-completion-theme-${themeMode}`]}`,
              }}
            >
              {option}
            </Tooltip>
          )
        })}
      </div>
      {showShortcutFooter ? (
        <div id={`${id}-shortcuts`} className={styles['terminal-completion-shortcuts']}>
          {navigationShortcuts.length > 0 ? (
            <span className={styles['terminal-completion-shortcut']}>
              <kbd>{navigationShortcuts.join(' / ')}</kbd>
              <span>{t('terminal.completion.shortcuts.navigate')}</span>
            </span>
          ) : null}
          {acceptShortcut ? (
            <span className={styles['terminal-completion-shortcut']}>
              <kbd>{acceptShortcut}</kbd>
              <span>{t('terminal.completion.shortcuts.select')}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
