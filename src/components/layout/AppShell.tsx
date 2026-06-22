import {
  DatabaseZap,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Server,
  Settings,
  Sun,
  TerminalSquare,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PageKey, ThemeMode } from '../../types/domain'
import { StatusBadge } from '../ui/StatusBadge'

interface AppShellProps {
  page: PageKey
  theme: ThemeMode
  sidebarCollapsed: boolean
  apiReady: boolean
  onNavigate: (page: PageKey) => void
  onToggleTheme: () => void
  onToggleSidebar: () => void
  onReload: () => void
  children: React.ReactNode
}

const navItems = [
  { key: 'workbench' as const, icon: TerminalSquare },
  { key: 'hosts' as const, icon: Server },
  { key: 'vault' as const, icon: DatabaseZap },
  { key: 'settings' as const, icon: Settings },
]

export function AppShell({
  page,
  theme,
  sidebarCollapsed,
  apiReady,
  onNavigate,
  onToggleTheme,
  onToggleSidebar,
  onReload,
  children,
}: AppShellProps) {
  const { t } = useTranslation()

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
              <button
                type="button"
                key={item.key}
                className={`nav-item ${page === item.key ? 'is-active' : ''}`}
                onClick={() => onNavigate(item.key)}
                aria-label={t(`nav.${item.key}`)}
                title={t(`nav.${item.key}`)}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{t(`nav.${item.key}`)}</span>
              </button>
            )
          })}
        </nav>
      </aside>

      <div className="main-frame">
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="icon-button" onClick={onToggleSidebar} aria-label={t('app.collapse')}>
              {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
            <div className="global-search" aria-label={t('app.search')}>
              <span>{t('app.search')}</span>
            </div>
          </div>
          <div className="topbar-actions">
            <StatusBadge
              status={apiReady ? 'available' : 'offline'}
              label={apiReady ? t('app.apiOnline') : t('app.apiOffline')}
            />
            <button type="button" className="icon-button" onClick={onReload} aria-label={t('app.reload')}>
              <RefreshCw size={17} />
            </button>
            <button type="button" className="icon-button" onClick={onToggleTheme} aria-label={t('app.theme')}>
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </header>
        <main className="content-frame">{children}</main>
      </div>
    </div>
  )
}
