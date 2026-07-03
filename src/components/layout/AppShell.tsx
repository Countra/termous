import {
  Cable,
  ChevronDown,
  DatabaseZap,
  FileCode2,
  FolderTree,
  Monitor,
  MonitorCog,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Route,
  Server,
  Settings,
  Shell,
  Sun,
  TerminalSquare,
} from 'lucide-react'
import { Button, Dropdown, Tooltip, type MenuProps } from 'antd'
import { useTranslation } from 'react-i18next'
import type { LocalShell, PageKey, ThemeMode } from '../../types/domain'
import { WindowControls } from './WindowControls'

interface AppShellProps {
  page: PageKey
  theme: ThemeMode
  appVersion: string
  sidebarCollapsed: boolean
  refreshing: boolean
  actionBusy: boolean
  onNavigate: (page: PageKey) => void
  onOpenConnectionLauncher: () => void
  onOpenLocalTerminal: (shell: LocalShell) => void
  onToggleTheme: () => void
  onToggleSidebar: () => void
  onReload: () => void
  onBeforeClose?: () => Promise<void>
  onCloseError?: (error: unknown) => void
  children: React.ReactNode
}

const navItems = [
  { key: 'workbench' as const, icon: TerminalSquare },
  { key: 'hosts' as const, icon: Server },
  { key: 'vault' as const, icon: DatabaseZap },
  { key: 'files' as const, icon: FolderTree },
  { key: 'forwards' as const, icon: Route },
  { key: 'snippets' as const, icon: FileCode2 },
]

const topbarPageIcons: Partial<Record<PageKey, typeof TerminalSquare>> = {
  workbench: MonitorCog,
}

export function AppShell({
  page,
  theme,
  appVersion,
  sidebarCollapsed,
  refreshing,
  actionBusy,
  onNavigate,
  onOpenConnectionLauncher,
  onOpenLocalTerminal,
  onToggleTheme,
  onToggleSidebar,
  onReload,
  onBeforeClose,
  onCloseError,
  children,
}: AppShellProps) {
  const { t } = useTranslation()
  const platform = window.termous?.platform ?? 'web'
  const showWindowControls = Boolean(window.termous?.windowControls) && platform !== 'darwin'
  const pageTitle = t(`nav.${page}`)
  const PageIcon = topbarPageIcons[page] ?? navItems.find((item) => item.key === page)?.icon ?? TerminalSquare
  const connectionMenuItems: MenuProps['items'] = [
    {
      key: 'host',
      label: <TopbarConnectionMenuItem icon={<Cable size={15} />} title={t('workbench.hostLauncher.kicker')} />,
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

  const handleConnectionMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'host') {
      onOpenConnectionLauncher()
      return
    }
    if (key === 'powershell' || key === 'cmd') {
      onOpenLocalTerminal(key)
    }
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
      <aside className="sidebar" aria-label="Primary">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            <img src="./termous-icon.png" alt="" />
          </div>
          <div className="brand-copy">
            <strong>{t('app.name')}</strong>
          </div>
          <span className="brand-version">v{appVersion}</span>
        </div>
        <nav className="primary-nav">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <Tooltip key={item.key} title={sidebarCollapsed ? t(`nav.${item.key}`) : undefined} placement="right">
                <Button
                  type="text"
                  className={`nav-item ${page === item.key ? 'is-active' : ''}`}
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
        <div className="sidebar-footer">
          <Tooltip title={sidebarCollapsed ? t('nav.settings') : undefined} placement="right">
            <Button
              type="text"
              className={`nav-item ${page === 'settings' ? 'is-active' : ''}`}
              onClick={() => onNavigate('settings')}
              aria-label={t('nav.settings')}
              icon={<Settings size={18} aria-hidden="true" />}
            >
              <span>{t('nav.settings')}</span>
            </Button>
          </Tooltip>
        </div>
      </aside>

      <div className="main-frame">
        <header className="window-chrome">
          <div className="chrome-drag-region">
            <Tooltip title={sidebarCollapsed ? t('app.expand') : t('app.collapse')}>
              <Button
                type="text"
                className="icon-button"
                onClick={onToggleSidebar}
                aria-label={sidebarCollapsed ? t('app.expand') : t('app.collapse')}
                icon={sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
              />
            </Tooltip>
            <div className="chrome-title">
              <span>{pageTitle}</span>
              <PageIcon className="chrome-title-icon" size={18} strokeWidth={2.1} aria-hidden="true" />
            </div>
          </div>
          <div className="topbar-actions">
            <div className="topbar-connect-group" aria-label={t('app.connect')}>
              <Dropdown.Button
                type="primary"
                className="topbar-connect-dropdown-button"
                trigger={['click']}
                placement="bottomRight"
                disabled={actionBusy}
                overlayClassName="topbar-connect-dropdown"
                menu={{ items: connectionMenuItems, onClick: handleConnectionMenuClick }}
                icon={<ChevronDown size={15} aria-hidden="true" />}
                onClick={onOpenConnectionLauncher}
              >
                <span className="topbar-connect-content">
                  <Cable size={16} aria-hidden="true" />
                  <span>{t('app.connect')}</span>
                </span>
              </Dropdown.Button>
            </div>
            <span className="topbar-action-divider" aria-hidden="true" />
            <Tooltip title={t('app.reload')}>
              <Button
                type="text"
                className="icon-button"
                onClick={onReload}
                aria-label={t('app.reload')}
                icon={<RefreshCw className={refreshing ? 'is-spinning' : ''} size={17} />}
              />
            </Tooltip>
            <Tooltip title={t('app.theme')}>
              <Button
                type="text"
                className="icon-button"
                onClick={onToggleTheme}
                aria-label={t('app.theme')}
                icon={theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
              />
            </Tooltip>
            {showWindowControls ? <WindowControls onBeforeClose={onBeforeClose} onCloseError={onCloseError} /> : null}
          </div>
        </header>
        <main className="content-frame">{children}</main>
      </div>
    </div>
  )
}

function TopbarConnectionMenuItem({ icon, title }: { icon: JSX.Element; title: string }) {
  return (
    <span className="topbar-connect-menu-item">
      <span className="topbar-connect-menu-icon">{icon}</span>
      <span>{title}</span>
    </span>
  )
}
