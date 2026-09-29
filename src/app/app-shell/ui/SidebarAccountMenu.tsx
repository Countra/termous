import { Avatar, Button, Dropdown, type MenuProps } from 'antd'
import { Cloud, LogIn, Monitor, Settings, ShieldCheck, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CloudTab } from '#common/contracts'
import { contextActionMenuPopupClassName } from '#shared/ui'
import styles from './SidebarAccountMenu.module.scss'

export interface SidebarAccountIdentity {
  authenticated: boolean
  name?: string
  avatar?: string
  email?: string
}

interface Props {
  identity?: SidebarAccountIdentity
  collapsed: boolean
  active: boolean
  getPopupWidth?: () => number | undefined
  onAccount: (tab: CloudTab) => void
  onSettings: () => void
}

export function SidebarAccountMenu({ identity, collapsed, active, getPopupWidth, onAccount, onSettings }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [width, setWidth] = useState(216)
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const loggedIn = identity?.authenticated === true
  const name = loggedIn ? identity.name || identity.email || t('nav.account') : t('cloud.local')
  const detail = loggedIn ? identity.email : t('cloud.localHint')
  const avatar = <Avatar size={32} src={loggedIn ? identity.avatar || undefined : undefined} icon={loggedIn ? <UserRound size={17} /> : <Monitor size={17} />} />

  useEffect(() => { setOpen(false) }, [collapsed, identity?.authenticated, identity?.email])
  useEffect(() => {
    const close = () => setOpen(false)
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [])
  useEffect(() => {
    if (!open) return
    // 自定义摘要位于菜单之前，显式将键盘焦点交给菜单而非不可交互的摘要。
    const frame = requestAnimationFrame(() => popup.current?.querySelector<HTMLElement>('[role="menu"]')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  const items: MenuProps['items'] = loggedIn ? [
    { key: 'profile', label: t('cloud.tabs.profile'), icon: <UserRound size={16} /> },
    { key: 'sync', label: t('cloud.tabs.sync'), icon: <Cloud size={16} /> },
    { key: 'devices', label: t('cloud.tabs.devices'), icon: <ShieldCheck size={16} /> },
    { type: 'divider' },
    { key: 'settings', label: t('nav.settings'), icon: <Settings size={16} /> },
  ] : [
    { key: 'profile', label: t('cloud.signInAccount'), icon: <LogIn size={16} /> },
    { type: 'divider' },
    { key: 'settings', label: t('nav.settings'), icon: <Settings size={16} /> },
  ]

  return <Dropdown
    autoFocus
    trigger={['click']}
    placement="topLeft"
    open={open}
    onOpenChange={(next) => {
      if (next) setWidth(collapsed ? 236 : getPopupWidth?.() || trigger.current?.getBoundingClientRect().width || 216)
      setOpen(next)
    }}
    classNames={{ root: `${contextActionMenuPopupClassName} ${styles.popup}` }}
    styles={{ root: { width, minWidth: width, maxWidth: 'calc(100vw - 24px)' } }}
    popupRender={(menu) => <div ref={popup}>
      <div className={styles.summary}>
        {avatar}
        <div className={styles.copy}><strong title={name}>{name}</strong><span title={detail}>{detail}</span></div>
      </div>
      {menu}
    </div>}
    menu={{
      items,
      onClick: ({ key }) => {
        setOpen(false)
        if (key === 'settings') onSettings()
        else if (key === 'profile' || key === 'sync' || key === 'devices') onAccount(key)
        trigger.current?.focus({ preventScroll: true })
      },
      onKeyDown: (event) => {
        if (event.key === 'Escape') {
          setOpen(false)
          queueMicrotask(() => trigger.current?.focus({ preventScroll: true }))
        }
      },
    }}
  >
    <Button ref={trigger} type="text" className={`${styles.trigger} ${collapsed ? styles.collapsed : ''} ${active ? styles.active : ''}`}
      title={collapsed ? name : undefined} aria-label={t('cloud.accountMenu', { name })} aria-haspopup="menu" aria-expanded={open}>
      {avatar}
      {!collapsed ? <span className={styles.copy}><strong title={name}>{name}</strong></span> : null}
    </Button>
  </Dropdown>
}
