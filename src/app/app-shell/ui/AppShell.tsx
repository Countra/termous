import {
  Bot,
  ChevronDown,
  CircleHelp,
  DatabaseZap,
  FileCode2,
  FolderTree,
  Info,
  Monitor,
  MonitorCog,
  MonitorPlay,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  Route,
  Server,
  Settings,
  Shell,
  TerminalSquare,
} from 'lucide-react'
import { Button, Dropdown, Space, Tooltip, type MenuProps } from 'antd'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { getTermousBridge } from '#shared/bridge'
import type { WindowCloseBehavior } from '#common/contracts'
import type { LocalShell } from '#entities/session'
import type { PageKey } from '#shared/model'
import { contextActionMenuPopupClassName } from '#shared/ui'
import { BrandVersionControl, useOpenUpdateWindow } from '#features/update'
import { WindowControls } from './WindowControls'
import styles from './AppShell.module.scss'

export interface AppShellProps {
  page: PageKey
  appVersion: string
  windowCloseBehavior: WindowCloseBehavior
  sidebarCollapsed: boolean
  actionBusy: boolean
  onNavigate: (page: PageKey) => void
  onOpenConnectionLauncher: () => void
  onOpenLocalTerminal: (shell: LocalShell) => void
  onOpenProductTour: () => void
  onToggleSidebar: () => void
  onBeforeClose?: () => Promise<void>
  onCloseError?: (error: unknown) => void
  children: React.ReactNode
}

const navItems = [
  { key: 'workbench' as const, icon: TerminalSquare },
  { key: 'remote-desktop' as const, icon: MonitorPlay },
  { key: 'hosts' as const, icon: Server },
  { key: 'vault' as const, icon: DatabaseZap },
  { key: 'files' as const, icon: FolderTree },
  { key: 'forwards' as const, icon: Route },
  { key: 'snippets' as const, icon: FileCode2 },
  { key: 'agent' as const, icon: Bot },
]

const topbarPageIcons: Partial<Record<PageKey, typeof TerminalSquare>> = {
  workbench: MonitorCog,
}

const helpDropdownClassName = [
  contextActionMenuPopupClassName,
  styles['app-help-dropdown'],
].join(' ')

export function AppShell({
  page,
  appVersion,
  windowCloseBehavior,
  sidebarCollapsed,
  actionBusy,
  onNavigate,
  onOpenConnectionLauncher,
  onOpenLocalTerminal,
  onOpenProductTour,
  onToggleSidebar,
  onBeforeClose,
  onCloseError,
  children,
}: AppShellProps) {
  const { t } = useTranslation()
  const { opening: openingAbout, open: openAbout } = useOpenUpdateWindow()
  const [sidebarHelpOpen, setSidebarHelpOpen] = useState(false)
  const [topbarHelpOpen, setTopbarHelpOpen] = useState(false)
  const sidebarHelpButtonRef = useRef<HTMLButtonElement>(null)
  const topbarHelpButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const closeHelpMenus = () => {
      setSidebarHelpOpen(false)
      setTopbarHelpOpen(false)
    }
    window.addEventListener('resize', closeHelpMenus)
    return () => window.removeEventListener('resize', closeHelpMenus)
  }, [])

  const bridge = getTermousBridge()
  const platform = bridge?.platform ?? 'web'
  const showWindowControls = Boolean(bridge?.windowControls) && platform !== 'darwin'
  const pageTitle = t(`nav.${page}`)
  const PageIcon = topbarPageIcons[page] ?? navItems.find((item) => item.key === page)?.icon ?? TerminalSquare
  const connectionMenuItems: MenuProps['items'] = [
    {
      key: 'host',
      label: <TopbarConnectionMenuItem icon={<PlugZap size={15} />} title={t('workbench.hostLauncher.kicker')} />,
    },
    {
      key: 'powershell',
      label: <TopbarConnectionMenuItem icon={<Shell size={15} />} title={t('workbench.openPowerShell')} />,
    },
    {
      key: 'cmd',
      label: <TopbarConnectionMenuItem icon={<Monitor size={15} />} title={t('workbench.openCmd')} />,
    },
  ]
  const helpMenuItems: MenuProps['items'] = [
    {
      key: 'product-tour',
      icon: <CircleHelp size={15} aria-hidden="true" />,
      label: t('productTour.menuLabel'),
    },
    {
      key: 'about',
      icon: <Info size={15} aria-hidden="true" />,
      label: t('update.global.aboutMenuLabel'),
      disabled: openingAbout,
    },
  ]

  const handleConnectionMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'host') {
      onOpenConnectionLauncher()
      return
    }
    if (key === 'powershell' || key === 'cmd') {
      onOpenLocalTerminal(key)
    }
  }

  const handleHelpMenuClick: MenuProps['onClick'] = ({ key }) => {
    setSidebarHelpOpen(false)
    setTopbarHelpOpen(false)
    if (key === 'product-tour') onOpenProductTour()
    if (key === 'about') void openAbout()
  }

  return (
    <div className={`${styles['app-shell']} ${sidebarCollapsed ? styles['is-collapsed'] : ''}`}>
      <aside className={styles.sidebar} aria-label="Primary">
        <div className={styles['brand-row']}>
          <div className={styles['brand-mark']} aria-hidden="true">
            <img src="./termous-icon.png" alt="" />
          </div>
          <div className={styles['brand-copy']}>
            <strong>{t('app.name')}</strong>
            <BrandVersionControl
              appVersion={appVersion}
              collapsed={sidebarCollapsed}
            />
          </div>
        </div>
        <nav className={styles['primary-nav']}>
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <Tooltip key={item.key} title={sidebarCollapsed ? t(`nav.${item.key}`) : undefined} placement="right">
                <Button
                  type="text"
                  className={`${styles['nav-item']} ${page === item.key ? styles['is-active'] : ''}`}
                  data-tour={item.key === 'vault' ? 'nav-vault' : undefined}
                  onClick={() => onNavigate(item.key)}
                  aria-label={t(`nav.${item.key}`)}
                  icon={<Icon size={18} aria-hidden="true" />}
                >
                  <span>{t(`nav.${item.key}`)}</span>
                </Button>
              </Tooltip>
            )
          })}
        </nav>
        <div className={styles['sidebar-footer']}>
          <div className={styles['sidebar-footer-actions']}>
            <Tooltip title={sidebarCollapsed ? t('nav.settings') : undefined} placement="right">
              <Button
                type="text"
                className={`${styles['nav-item']} ${styles['sidebar-settings-button']} ${page === 'settings' ? styles['is-active'] : ''}`}
                onClick={() => onNavigate('settings')}
                aria-label={t('nav.settings')}
                icon={<Settings size={18} aria-hidden="true" />}
              >
                <span>{t('nav.settings')}</span>
              </Button>
            </Tooltip>
            <span className={styles['product-tour-trigger']} data-tour="product-tour-trigger">
              <Tooltip title={t('productTour.helpButton')} placement={sidebarCollapsed ? 'right' : 'top'}>
                <Dropdown
                  autoFocus
                  trigger={['click']}
                  placement="topLeft"
                  open={sidebarHelpOpen}
                  onOpenChange={(open) => {
                    setSidebarHelpOpen(open)
                    if (open) setTopbarHelpOpen(false)
                  }}
                  classNames={{ root: helpDropdownClassName }}
                  menu={{
                    items: helpMenuItems,
                    onClick: handleHelpMenuClick,
                    rootClassName: helpDropdownClassName,
                    onKeyDown: (event) => {
                      if (event.key === 'Escape') {
                        queueMicrotask(() => sidebarHelpButtonRef.current?.focus({ preventScroll: true }))
                      }
                    },
                  }}
                >
                  <Button
                    ref={sidebarHelpButtonRef}
                    type="text"
                    className={styles['sidebar-help-button']}
                    aria-label={t('productTour.helpButton')}
                    aria-haspopup="menu"
                    aria-expanded={sidebarHelpOpen}
                    icon={<CircleHelp size={18} aria-hidden="true" />}
                  />
                </Dropdown>
              </Tooltip>
            </span>
          </div>
        </div>
      </aside>

      <div className={styles['main-frame']}>
        <header className={styles['window-chrome']}>
          <div className={styles['chrome-drag-region']}>
            <Tooltip title={sidebarCollapsed ? t('app.expand') : t('app.collapse')}>
              <Button
                type="text"
                className={styles['icon-button']}
                onClick={onToggleSidebar}
                aria-label={sidebarCollapsed ? t('app.expand') : t('app.collapse')}
                icon={sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
              />
            </Tooltip>
            <div className={styles['chrome-title']}>
              <span>{pageTitle}</span>
              <PageIcon className={styles['chrome-title-icon']} size={18} strokeWidth={2.1} aria-hidden="true" />
            </div>
          </div>
          <div className={styles['topbar-actions']}>
            <span
              className={`${styles['product-tour-trigger']} ${styles['topbar-product-tour-trigger']}`}
              data-tour="product-tour-trigger"
            >
              <Tooltip title={t('productTour.helpButton')} placement="bottom">
                <Dropdown
                  autoFocus
                  trigger={['click']}
                  placement="bottomLeft"
                  open={topbarHelpOpen}
                  onOpenChange={(open) => {
                    setTopbarHelpOpen(open)
                    if (open) setSidebarHelpOpen(false)
                  }}
                  classNames={{ root: helpDropdownClassName }}
                  menu={{
                    items: helpMenuItems,
                    onClick: handleHelpMenuClick,
                    rootClassName: helpDropdownClassName,
                    onKeyDown: (event) => {
                      if (event.key === 'Escape') {
                        queueMicrotask(() => topbarHelpButtonRef.current?.focus({ preventScroll: true }))
                      }
                    },
                  }}
                >
                  <Button
                    ref={topbarHelpButtonRef}
                    type="text"
                    className={styles['icon-button']}
                    aria-label={t('productTour.helpButton')}
                    aria-haspopup="menu"
                    aria-expanded={topbarHelpOpen}
                    icon={<CircleHelp size={18} aria-hidden="true" />}
                  />
                </Dropdown>
              </Tooltip>
            </span>
            <div className={styles['topbar-connect-group']} aria-label={t('app.connect')} data-tour="topbar-connect">
              <Space.Compact className={styles['topbar-connect-dropdown-button']}>
                <Button type="primary" disabled={actionBusy} onClick={onOpenConnectionLauncher}>
                  <span className={styles['topbar-connect-content']}>
                    <span className={styles['topbar-connect-mark']} aria-hidden="true">
                      <PlugZap size={18} strokeWidth={2.15} />
                    </span>
                    <span className={styles['topbar-connect-label']}>{t('app.connect')}</span>
                  </span>
                </Button>
                <Dropdown
                  trigger={['click']}
                  placement="bottomRight"
                  disabled={actionBusy}
                  classNames={{ root: styles['topbar-connect-dropdown'] }}
                  menu={{ items: connectionMenuItems, onClick: handleConnectionMenuClick }}
                >
                  <Button type="primary" disabled={actionBusy} aria-label={t('app.connect')} icon={<ChevronDown size={15} aria-hidden="true" />} />
                </Dropdown>
              </Space.Compact>
            </div>
            <span className={styles['topbar-action-divider']} aria-hidden="true" />
            {showWindowControls ? (
              <WindowControls
                closeBehavior={windowCloseBehavior}
                onBeforeClose={onBeforeClose}
                onCloseError={onCloseError}
              />
            ) : null}
          </div>
        </header>
        <main className={styles['content-frame']}>{children}</main>
      </div>
    </div>
  )
}

function TopbarConnectionMenuItem({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <span className={styles['topbar-connect-menu-item']}>
      <span className={styles['topbar-connect-menu-icon']}>{icon}</span>
      <span>{title}</span>
    </span>
  )
}
