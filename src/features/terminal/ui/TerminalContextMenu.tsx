import { Dropdown, Tooltip, type MenuProps } from 'antd'
import {
  ClipboardPaste,
  Bot,
  Copy,
  Eraser,
  ExternalLink,
  FolderOpen,
  Link2,
  RefreshCw,
  Search,
  Sparkles,
  TextSelect,
  type LucideIcon,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useShortcutRuntime } from '#entities/shortcuts'
import { useSessionTargetMenu, contextActionMenuPopupClassName, uiStyles } from '#shared/ui'
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
  const referenceMenu = useSessionTargetMenu({ open, instanceId, submenuKey: 'reference_selection',
    ready: referenceSnapshot?.ready ?? false, enabled: referenceSnapshot?.canReference ?? false,
    targets: referenceSnapshot?.targets ?? [], onSelect: onReferenceTarget,
  })
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
          popupClassName: referenceMenu.popupClassName,
          children: referenceMenu.items,
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
        openKeys: referenceMenu.openKeys,
        onOpenChange: referenceMenu.onOpenChange,
        'aria-label': t('terminal.contextMenu.label'),
        onClick: ({ key }) => {
          if (referenceMenu.onClick(key)) return
          if (items.some((item) => item.type === 'action' && item.key === key && !item.disabled)) {
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
