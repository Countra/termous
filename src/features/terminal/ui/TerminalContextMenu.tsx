import { Dropdown, Input, Tooltip, type InputRef, type MenuProps } from 'antd'
import {
  ClipboardPaste,
  Bot,
  Copy,
  Eraser,
  ExternalLink,
  FolderOpen,
  Link2,
  MessageSquare,
  MessageSquarePlus,
  Pin,
  RefreshCw,
  Search,
  Sparkles,
  TextSelect,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useShortcutRuntime } from '#entities/shortcuts'
import { contextActionMenuPopupClassName, uiStyles } from '#shared/ui'
import type {
  TerminalContextMenuActionKey,
  TerminalContextMenuItem,
} from '../model/terminalContextMenuModel.ts'
import { terminalContextMenuShortcutAction } from '../model/terminalContextMenuShortcuts'
import type { TerminalAIReferenceSelection, TerminalAIReferenceSnapshot } from '../model/terminalAIReference'
import styles from './TerminalContextMenu.module.scss'

interface TerminalContextMenuProps {
  instanceId: number
  open: boolean
  autoFocus: boolean
  point: { x: number; y: number }
  items: TerminalContextMenuItem[]
  onAction: (action: TerminalContextMenuActionKey) => void
  referenceSnapshot?: TerminalAIReferenceSnapshot
  onReferenceTarget?: (target: TerminalAIReferenceSelection['target']) => void
  onOpenChange: (open: boolean) => void
}

const actionIcons: Record<TerminalContextMenuActionKey, LucideIcon> = {
  ai_command: Sparkles,
  reconnect: RefreshCw,
  open_link: ExternalLink,
  copy_link: Link2,
  open_path: FolderOpen,
  copy_path: Copy,
  copy_selection: Copy,
  find_selection: Search,
  paste: ClipboardPaste,
  clear: Eraser,
  select_all: TextSelect,
  find: Search,
}

const actionTranslationKeys: Record<TerminalContextMenuActionKey, string> = {
  ai_command: 'terminal.aiCompletion.title',
  reconnect: 'terminal.contextMenu.reconnect',
  open_link: 'terminal.contextMenu.openLink',
  copy_link: 'terminal.contextMenu.copyLink',
  open_path: 'terminal.contextMenu.openPath',
  copy_path: 'terminal.contextMenu.copyPath',
  copy_selection: 'terminal.contextMenu.copy',
  find_selection: 'terminal.contextMenu.findSelection',
  paste: 'terminal.contextMenu.paste',
  clear: 'terminal.contextMenu.clear',
  select_all: 'terminal.contextMenu.selectAll',
  find: 'terminal.contextMenu.find',
}

const terminalContextMenuMarker = {
  'data-terminal-context-menu': '',
}

const referenceNewKey = 'terminal-reference-new'
const referenceSessionPrefix = 'terminal-reference-session:'
const terminalContextMenuPopupMarker = 'termous-terminal-context-menu-popup'
export const terminalContextMenuSelector = `[data-terminal-context-menu], .${terminalContextMenuPopupMarker}`

export function TerminalContextMenu({
  instanceId,
  open,
  autoFocus,
  point,
  items,
  onAction,
  referenceSnapshot,
  onReferenceTarget,
  onOpenChange,
}: TerminalContextMenuProps) {
  const { t } = useTranslation()
  const { labels: shortcutLabels } = useShortcutRuntime()
  const referenceSearchRef = useRef<InputRef>(null)
  const [referenceQuery, setReferenceQuery] = useState('')
  const [openKeys, setOpenKeys] = useState<string[]>([])
  useEffect(() => { setReferenceQuery(''); setOpenKeys([]) }, [instanceId, open])
  const referenceTargets = useMemo(() => (
    referenceSnapshot?.targets.filter(({ title }) => title.toLocaleLowerCase().includes(referenceQuery.trim().toLocaleLowerCase())) ?? []
  ), [referenceQuery, referenceSnapshot])
  const referenceItems: NonNullable<MenuProps['items']> = [
    {
      key: referenceNewKey,
      icon: <MessageSquarePlus size={16} aria-hidden="true" />,
      label: t('terminal.aiReference.newSession'),
      disabled: !referenceSnapshot?.ready,
    },
    { type: 'divider', key: 'reference-divider' },
    {
      type: 'group', key: 'reference-sessions',
      label: <Input
        ref={referenceSearchRef}
        size="small"
        className={styles['reference-search']}
        prefix={<Search size={13} aria-hidden="true" />}
        value={referenceQuery}
        placeholder={t('terminal.aiReference.search')}
        aria-label={t('terminal.aiReference.search')}
        onChange={(event) => setReferenceQuery(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'Enter') event.preventDefault()
          if (event.key === 'ArrowDown' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
            event.preventDefault()
            event.currentTarget.closest('[role="menu"]')?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
          }
        }}
      />,
      children: !referenceSnapshot?.ready ? [
        { key: 'reference-loading', disabled: true, label: t('terminal.aiReference.loading') },
      ] : referenceTargets.length > 0 ? referenceTargets.map((target) => ({
        key: `${referenceSessionPrefix}${target.session_id}`,
        disabled: target.disabled,
        icon: target.pinned ? <Pin size={14} aria-hidden="true" /> : <MessageSquare size={15} aria-hidden="true" />,
        label: <span className={styles['reference-target']}>
          <TerminalMenuLabel text={target.title} />
          {target.disabled_reason ? <small>{t(`terminal.aiReference.${target.disabled_reason}`)}</small> : null}
        </span>,
      })) : [
        { key: 'reference-empty', disabled: true, label: t(referenceQuery.trim() ? 'terminal.aiReference.noMatches' : 'terminal.aiReference.noSessions') },
      ],
    },
  ]
  const menuItems: NonNullable<MenuProps['items']> = items.map((item) => {
      if (item.type === 'separator') {
        return { type: 'divider', key: item.key }
      }
      if (item.type === 'reference') {
        return {
          key: item.key,
          disabled: item.disabled,
          icon: <Bot size={16} strokeWidth={1.8} aria-hidden="true" />,
          label: <span className={styles['reference-target']}>
            <TerminalMenuLabel text={t('terminal.contextMenu.referenceSelection')} />
            {item.disabled ? <small>{t('terminal.aiReference.sourceUnavailable')}</small> : null}
          </span>,
          popupClassName: styles['reference-popup'],
          children: referenceItems,
        }
      }
      const Icon = actionIcons[item.key]
      const shortcutAction = terminalContextMenuShortcutAction(item.key)
      const shortcut = shortcutAction ? shortcutLabels.get(shortcutAction)?.[0] : undefined
      return {
        key: item.key,
        disabled: item.disabled,
        icon: <Icon size={16} strokeWidth={1.8} aria-hidden="true" />,
        label: (
          <span className={styles.label}>
            <TerminalMenuLabel text={t(actionTranslationKeys[item.key])} />
            {shortcut ? (
              <kbd>{shortcut}</kbd>
            ) : null}
          </span>
        ),
      }
    })

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <Dropdown
      key={instanceId}
      open={open && menuItems.length > 0}
      trigger={[]}
      placement="bottomLeft"
      align={{ offset: [2, 2] }}
      autoAdjustOverflow
      autoFocus={autoFocus}
      destroyOnHidden
      transitionName=""
      getPopupContainer={() => document.body}
      classNames={{ root: `${contextActionMenuPopupClassName} ${styles.root} ${terminalContextMenuPopupMarker}` }}
      menu={{
        ...terminalContextMenuMarker,
        rootClassName: `${contextActionMenuPopupClassName} ${styles.root} ${terminalContextMenuPopupMarker}`,
        items: menuItems,
        selectable: false,
        openKeys,
        onOpenChange: (nextKeys) => {
          // 过滤导致浮层缩短并重新定位时，悬停离开不能夺走搜索焦点；菜单项仍允许方向键收起。
          setOpenKeys(referenceSearchRef.current?.input === document.activeElement
            ? [...new Set([...nextKeys, 'reference_selection'])]
            : nextKeys)
        },
        'aria-label': t('terminal.contextMenu.label'),
        onClick: ({ key }) => {
          if (key === referenceNewKey || key.startsWith(referenceSessionPrefix)) {
            if (!referenceSnapshot?.canReference || !referenceSnapshot.ready) return
            if (key === referenceNewKey) onReferenceTarget?.({ kind: 'new' })
            else {
              const target = referenceSnapshot.targets.find(({ session_id }) => key === `${referenceSessionPrefix}${session_id}`)
              if (target && !target.disabled) onReferenceTarget?.({ kind: 'session', session_id: target.session_id })
            }
          } else if (items.some((item) => item.type === 'action' && item.key === key && !item.disabled)) {
            onAction(key as TerminalContextMenuActionKey)
          }
        },
      }}
      onOpenChange={onOpenChange}
    >
      <span
        className={styles.anchor}
        style={{ left: point.x, top: point.y }}
        aria-hidden="true"
      />
    </Dropdown>,
    document.body,
  )
}

function TerminalMenuLabel({ text }: { text: string }) {
  const labelRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <Tooltip
      title={text}
      open={open}
      onOpenChange={(nextOpen) => {
        const label = labelRef.current
        // 按当前布局判断省略，避免短菜单项也弹提示；不增加额外键盘焦点。
        setOpen(Boolean(nextOpen && label && label.scrollWidth > label.clientWidth))
      }}
      placement="topLeft"
      arrow={false}
      mouseEnterDelay={0.4}
      mouseLeaveDelay={0}
      destroyOnHidden
      classNames={{ root: `${uiStyles.tooltip} termous-tooltip ${styles['label-tooltip']}` }}
    >
      <span ref={labelRef} onClick={() => setOpen(false)}>{text}</span>
    </Tooltip>
  )
}
