import { Input, type InputRef, type MenuProps } from 'antd'
import { MessageSquare, MessageSquarePlus, Pin, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SessionTargetLabel } from './SessionTargetLabel'
import styles from './SessionTargetMenu.module.scss'

export interface SessionTargetOption {
  session_id: string
  title: string
  pinned?: boolean
  last_activity_at?: string
  disabled?: boolean
  disabled_reason?: 'binding_locked'
}

const newKey = 'terminal-reference-new'
const sessionPrefix = 'terminal-reference-session:'

export type SessionTarget = { kind: 'new' } | { kind: 'session'; session_id: string }

export function useSessionTargetMenu({ open, instanceId, submenuKey, ready, enabled, targets, onSelect }: {
  open: boolean
  instanceId?: number
  submenuKey: string
  ready: boolean
  enabled: boolean
  targets: readonly SessionTargetOption[]
  onSelect?: (target: SessionTarget) => void
}) {
  const { t } = useTranslation()
  const searchRef = useRef<InputRef>(null)
  const [query, setQuery] = useState('')
  const [openKeys, setOpenKeys] = useState<string[]>([])
  useEffect(() => { setQuery(''); setOpenKeys([]) }, [instanceId, open])
  const filtered = useMemo(() => targets.filter(({ title }) => title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
      || activityTime(right.last_activity_at) - activityTime(left.last_activity_at)
      || left.session_id.localeCompare(right.session_id)), [query, targets])
  const items: NonNullable<MenuProps['items']> = [
    { key: newKey, icon: <MessageSquarePlus size={16} aria-hidden="true" />,
      label: t('terminal.aiReference.newSession'), disabled: !ready || !enabled },
    { type: 'divider', key: 'reference-divider' },
    { type: 'group', key: 'reference-sessions', label: <Input
      ref={searchRef} size="small" className={styles.search} prefix={<Search size={13} aria-hidden="true" />}
      value={query} placeholder={t('terminal.aiReference.search')} aria-label={t('terminal.aiReference.search')}
      onChange={(event) => setQuery(event.target.value)} onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter') event.preventDefault()
        if (event.key === 'ArrowDown' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
          event.preventDefault()
          event.currentTarget.closest('[role="menu"]')?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
        }
      }} />,
      children: !ready ? [{ key: 'reference-loading', disabled: true, label: t('terminal.aiReference.loading') }]
        : filtered.length ? filtered.map((target) => ({
          key: `${sessionPrefix}${target.session_id}`, disabled: !enabled || target.disabled,
          icon: target.pinned ? <Pin size={14} aria-hidden="true" /> : <MessageSquare size={15} aria-hidden="true" />,
          label: <span className={styles.target}><SessionTargetLabel text={target.title} />
            {target.disabled_reason ? <small>{t(`terminal.aiReference.${target.disabled_reason}`)}</small> : null}</span>,
        })) : [{ key: 'reference-empty', disabled: true, label: t(query.trim() ? 'terminal.aiReference.noMatches' : 'terminal.aiReference.noSessions') }],
    },
  ]
  return {
    items,
    popupClassName: styles.popup,
    openKeys,
    onOpenChange: (nextKeys: string[]) => {
      // 搜索过滤改变浮层位置时保持子菜单，方向键仍可在离开输入框后收起。
      setOpenKeys(searchRef.current?.input === document.activeElement
        ? [...new Set([...nextKeys, submenuKey])] : nextKeys)
    },
    onClick: (key: string) => {
      if (key !== newKey && !key.startsWith(sessionPrefix)) return false
      if (!ready || !enabled) return true
      if (key === newKey) onSelect?.({ kind: 'new' })
      else {
        const target = targets.find(({ session_id }) => key === `${sessionPrefix}${session_id}`)
        if (target && !target.disabled) onSelect?.({ kind: 'session', session_id: target.session_id })
      }
      return true
    },
  }
}

function activityTime(value?: string) {
  const timestamp = value ? Date.parse(value) : 0
  return Number.isFinite(timestamp) ? timestamp : 0
}
