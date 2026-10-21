import { Avatar, Button, Dropdown, Tooltip, type MenuProps } from 'antd'
import { ChevronRight, Cloud, Laptop, LogIn, Monitor, Settings, ShieldCheck, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CloudTab } from '#common/contracts'
import { uiStyles } from '#shared/ui'
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
  const renderAvatar = (size: number) => <Avatar size={size} src={loggedIn ? identity.avatar || undefined : undefined}
    icon={loggedIn ? <UserRound size={16} aria-hidden="true" /> : <Monitor size={16} aria-hidden="true" />} />
  const summary = <span className={styles.summary}>
    {renderAvatar(32)}
    <span className={styles.copy}><strong title={name}>{name}</strong>{detail ? <span title={detail}>{detail}</span> : null}</span>
    {loggedIn ? <ChevronRight className={styles.chevron} size={14} aria-hidden="true" /> : null}
  </span>

  useEffect(() => { setOpen(false) }, [collapsed, identity?.authenticated, identity?.email])
  useEffect(() => {
    const close = () => setOpen(false)
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [])
  useEffect(() => {
    if (!open) return
    // 顶部用户入口与其他菜单项统一使用菜单的键盘导航。
    const frame = requestAnimationFrame(() => popup.current?.querySelector<HTMLElement>('[role="menu"]')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  const profileItem = { key: 'profile', label: summary, className: styles['identity-item'], 'aria-label': `${name} · ${t('cloud.tabs.profile')}` }
  const settingsItem = { key: 'settings', label: t('nav.settings'), icon: <span className={styles['action-icon']} aria-hidden="true"><Settings size={16} /></span> }
  const items: MenuProps['items'] = loggedIn ? [
    profileItem,
    { type: 'divider' },
    { key: 'sync', label: t('cloud.tabs.sync'), icon: <span className={styles['action-icon']} aria-hidden="true"><Cloud size={16} /></span> },
    { key: 'devices', label: t('cloud.tabs.devices'), icon: <span className={styles['action-icon']} aria-hidden="true"><Laptop size={16} /></span> },
    { key: 'security', label: t('cloud.tabs.security'), icon: <span className={styles['action-icon']} aria-hidden="true"><ShieldCheck size={16} /></span> },
    { type: 'divider' },
    settingsItem,
  ] : [
    { key: 'profile', label: t('cloud.signInAccount'), icon: <span className={styles['action-icon']} aria-hidden="true"><LogIn size={16} /></span> },
    settingsItem,
  ]

  return <Tooltip title={name} open={open ? false : undefined} placement={collapsed ? 'right' : 'top'}
    classNames={{ root: `${uiStyles.tooltip} termous-tooltip` }} destroyOnHidden>
    <Dropdown
      autoFocus
      trigger={['click']}
      placement="topLeft"
      open={open}
      onOpenChange={(next) => {
        if (next) setWidth(collapsed ? 236 : getPopupWidth?.() || trigger.current?.getBoundingClientRect().width || 216)
        setOpen(next)
      }}
      classNames={{ root: styles.popup }}
      styles={{ root: { width, minWidth: width, maxWidth: 'calc(100vw - 24px)' } }}
      popupRender={(menu) => <div ref={popup}>
        {!loggedIn ? <div className={styles['local-summary']}>{summary}</div> : null}
        {menu}
      </div>}
      menu={{
        items,
        onClick: ({ key, domEvent }) => {
          // Enter 选中后立即还原焦点，阻止默认动作再次触发账号按钮。
          if (domEvent.type === 'keydown') domEvent.preventDefault()
          setOpen(false)
          if (key === 'settings') onSettings()
          else if (key === 'profile' || key === 'sync' || key === 'devices' || key === 'security') onAccount(key)
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
        aria-label={t('cloud.accountMenu', { name })} aria-haspopup="menu" aria-expanded={open}>
        {renderAvatar(28)}
        {!collapsed ? <span className={styles.copy}><strong>{name}</strong></span> : null}
      </Button>
    </Dropdown>
  </Tooltip>
}
