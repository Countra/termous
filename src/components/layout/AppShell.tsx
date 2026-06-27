import {
  DatabaseZap,
  FolderTree,
  Moon,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Server,
  Settings,
  Sun,
  TerminalSquare,
} from 'lucide-react'
import { Badge, Button, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import type { PageKey, ThemeMode } from '../../types/domain'
import { WindowControls } from './WindowControls'

interface AppShellProps {
  page: PageKey
  theme: ThemeMode
  sidebarCollapsed: boolean
  apiReady: boolean
  refreshing: boolean
  onNavigate: (page: PageKey) => void
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
]

export function AppShell({
  page,
  theme,
  sidebarCollapsed,
  apiReady,
  refreshing,
  onNavigate,
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

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
      <aside className="sidebar" aria-label="Primary">
        <div className="brand-row">
          <div className="brand-mark">T</div>
          <div className="brand-copy">
            <strong>{t('app.name')}</strong>
            <span>SSH</span>
          </div>
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
                  title={t(`nav.${item.key}`)}
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
              title={t('nav.settings')}
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
              <PanelLeft size={15} aria-hidden="true" />
              <span>{pageTitle}</span>
            </div>
          </div>
          <div className="topbar-actions">
            <Badge
              status={apiReady ? 'success' : 'error'}
              text={apiReady ? t('app.apiOnline') : t('app.apiOffline')}
              className="api-status"
            />
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
