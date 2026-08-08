import { Dropdown, type MenuProps } from 'antd'
import {
  ClipboardPaste,
  Copy,
  ExternalLink,
  FolderOpen,
  Link2,
  RefreshCw,
  Search,
  TextSelect,
  type LucideIcon,
} from 'lucide-react'
import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useShortcutRuntime } from '#entities/shortcuts'
import type {
  TerminalContextMenuActionKey,
  TerminalContextMenuItem,
} from '../model/terminalContextMenuModel.ts'
import { terminalContextMenuShortcutAction } from '../model/terminalContextMenuShortcuts'

interface TerminalContextMenuProps {
  instanceId: number
  open: boolean
  autoFocus: boolean
  point: { x: number; y: number }
  items: TerminalContextMenuItem[]
  onAction: (action: TerminalContextMenuActionKey) => void
  onOpenChange: (open: boolean) => void
}

const actionIcons: Record<TerminalContextMenuActionKey, LucideIcon> = {
  reconnect: RefreshCw,
  open_link: ExternalLink,
  copy_link: Link2,
  open_path: FolderOpen,
  copy_path: Copy,
  copy_selection: Copy,
  find_selection: Search,
  paste: ClipboardPaste,
  select_all: TextSelect,
  find: Search,
}

const actionTranslationKeys: Record<TerminalContextMenuActionKey, string> = {
  reconnect: 'terminal.contextMenu.reconnect',
  open_link: 'terminal.contextMenu.openLink',
  copy_link: 'terminal.contextMenu.copyLink',
  open_path: 'terminal.contextMenu.openPath',
  copy_path: 'terminal.contextMenu.copyPath',
  copy_selection: 'terminal.contextMenu.copy',
  find_selection: 'terminal.contextMenu.findSelection',
  paste: 'terminal.contextMenu.paste',
  select_all: 'terminal.contextMenu.selectAll',
  find: 'terminal.contextMenu.find',
}

const terminalContextMenuMarker = {
  'data-terminal-context-menu': '',
}

export function TerminalContextMenu({
  instanceId,
  open,
  autoFocus,
  point,
  items,
  onAction,
  onOpenChange,
}: TerminalContextMenuProps) {
  const { t } = useTranslation()
  const { labels: shortcutLabels } = useShortcutRuntime()
  const menuItems = useMemo<NonNullable<MenuProps['items']>>(
    () => items.map((item) => {
      if (item.type === 'separator') {
        return { type: 'divider', key: item.key }
      }
      const Icon = actionIcons[item.key]
      const shortcutAction = terminalContextMenuShortcutAction(item.key)
      const shortcut = shortcutAction ? shortcutLabels.get(shortcutAction)?.[0] : undefined
      return {
        key: item.key,
        disabled: item.disabled,
        icon: <Icon className="terminal-context-menu-icon" size={16} strokeWidth={1.8} aria-hidden="true" />,
        label: (
          <span className="terminal-context-menu-label">
            <span>{t(actionTranslationKeys[item.key])}</span>
            {shortcut ? (
              <kbd>{shortcut}</kbd>
            ) : null}
          </span>
        ),
      }
    }),
    [items, shortcutLabels, t],
  )

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
      classNames={{ root: 'terminal-context-menu context-action-menu' }}
      menu={{
        ...terminalContextMenuMarker,
        items: menuItems,
        selectable: false,
        'aria-label': t('terminal.contextMenu.label'),
        onClick: ({ key }) => onAction(key as TerminalContextMenuActionKey),
      }}
      onOpenChange={onOpenChange}
    >
      <span
        className="terminal-context-menu-anchor"
        style={{ left: point.x, top: point.y }}
        aria-hidden="true"
      />
    </Dropdown>,
    document.body,
  )
}
