import { Dropdown, type MenuProps } from 'antd'
import { Bot } from 'lucide-react'
import { useState, type ReactElement } from 'react'
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
  children, items = [], onMenuClick, disabled = false, popupClassName }: {
  getSnapshot?: () => TargetSnapshot<Source> | undefined
  onSelect?: (source: Source, target: SessionTarget) => void
  children: ReactElement
  items?: MenuProps['items']
  onMenuClick?: MenuProps['onClick']
  disabled?: boolean
  popupClassName?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<TargetSnapshot<Source>>()
  const picker = useSessionTargetMenu({ open, submenuKey: 'agent-reference',
    ready: snapshot?.ready ?? false, enabled: snapshot?.enabled ?? false, targets: snapshot?.targets ?? [],
    onSelect: (target) => {
      if (snapshot?.source) onSelect?.(snapshot.source, target)
      setOpen(false)
    },
  })
  const available = Boolean(getSnapshot && onSelect)
  return <Dropdown open={open} trigger={['contextMenu']} destroyOnHidden disabled={disabled}
    classNames={{ root: `${contextActionMenuPopupClassName} ${popupClassName ?? ''}` }}
    onOpenChange={(next) => {
      if (next) setSnapshot(getSnapshot?.())
      setOpen(next)
    }} menu={{ items: [...(items ?? []), ...(available ? [{
      key: 'agent-reference', icon: <Bot size={15} aria-hidden="true" />, label: t('agent.launch.action'),
      disabled: snapshot?.ready === true && !snapshot.enabled,
      popupClassName: picker.popupClassName, children: picker.items,
    }] : [])], selectable: false, openKeys: picker.openKeys, onOpenChange: picker.onOpenChange,
    onClick: (info) => { if (!picker.onClick(info.key)) { onMenuClick?.(info); setOpen(false) } },
  }}>{children}</Dropdown>
}
