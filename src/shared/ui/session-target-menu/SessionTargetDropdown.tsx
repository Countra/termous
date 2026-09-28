import { Dropdown, type MenuProps } from 'antd'
import { Bot } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { contextActionMenuPopupClassName } from '../contextActionMenuStyles.ts'
import { useSessionTargetMenu, type SessionTarget, type SessionTargetOption } from './useSessionTargetMenu.tsx'

interface TargetSnapshot<Source> {
  ready: boolean
  enabled: boolean
  source?: Source
  targets: readonly SessionTargetOption[]
}

export function SessionTargetDropdown<Source>({ getSnapshot, onSelect,
  children, items = [], onMenuClick, disabled = false, popupClassName, onOpenChange }: {
  getSnapshot?: () => TargetSnapshot<Source> | undefined
  onSelect?: (source: Source, target: SessionTarget) => void
  children: ReactElement
  items?: MenuProps['items']
  onMenuClick?: MenuProps['onClick']
  disabled?: boolean
  popupClassName?: string
  onOpenChange?: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<TargetSnapshot<Source>>()
  useEffect(() => {
    if (disabled && open) {
      setOpen(false)
      onOpenChange?.(false)
    }
  }, [disabled, open, onOpenChange])
  const setMenuOpen = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }
  const picker = useSessionTargetMenu({ open: open && !disabled, submenuKey: 'agent-reference',
    ready: snapshot?.ready ?? false, enabled: snapshot?.enabled ?? false, targets: snapshot?.targets ?? [],
    onSelect: (target) => {
      if (disabled) return
      if (snapshot?.source) onSelect?.(snapshot.source, target)
      setMenuOpen(false)
    },
  })
  const available = Boolean(getSnapshot && onSelect)
  return <Dropdown open={open && !disabled} trigger={['contextMenu']} destroyOnHidden disabled={disabled}
    classNames={{ root: `${contextActionMenuPopupClassName} ${popupClassName ?? ''}` }}
    onOpenChange={(next) => {
      if (disabled && next) return
      if (next) setSnapshot(getSnapshot?.())
      setMenuOpen(next)
    }} menu={{ items: [...(items ?? []), ...(available ? [{
      key: 'agent-reference', icon: <Bot size={15} aria-hidden="true" />, label: t('agent.launch.action'),
      disabled: snapshot?.ready === true && !snapshot.enabled,
      popupClassName: picker.popupClassName, children: picker.items,
    }] : [])], selectable: false, openKeys: picker.openKeys, onOpenChange: picker.onOpenChange,
    onClick: (info) => { if (!disabled && !picker.onClick(info.key)) { onMenuClick?.(info); setMenuOpen(false) } },
  }}>{children}</Dropdown>
}
