import {
  Activity,
  Boxes,
  Cable,
  CalendarClock,
  Code2,
  Command,
  Cpu,
  FolderOpen,
  Monitor,
  Server,
  Shield,
  Wrench,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { FeatureSidePanel } from '#shared/ui'
import type { DetailsTabKey } from '../model/workbenchDetails'
import snippetStyles from './SnippetWorkbench.module.scss'

interface WorkbenchDetailsPanelProps {
  activeKey: DetailsTabKey
  collapsed: boolean
  resizing: boolean
  panels: Record<DetailsTabKey, ReactNode>
  onActiveKeyChange: (key: DetailsTabKey) => void
  onCollapsedChange: (collapsed: boolean) => void
  onResizePointerDown: (event: ReactPointerEvent<HTMLElement>) => void
}

export function WorkbenchDetailsPanel({
  activeKey,
  collapsed,
  resizing,
  panels,
  onActiveKeyChange,
  onCollapsedChange,
  onResizePointerDown,
}: WorkbenchDetailsPanelProps) {
  const { t } = useTranslation()
  return (
    <FeatureSidePanel<DetailsTabKey>
      activeKey={activeKey}
      ariaLabel={t('workbench.currentConnection')}
      className={snippetStyles['workbench-panel-root']}
      collapsed={collapsed}
      collapseLabel={t('app.collapse')}
      expandLabel={t('app.expand')}
      resizing={resizing}
      onActiveKeyChange={onActiveKeyChange}
      onCollapsedChange={onCollapsedChange}
      onResizePointerDown={onResizePointerDown}
      tabs={[
        {
          key: 'overview',
          label: t('workbench.detailsTabs.overview'),
          icon: <Server size={17} aria-hidden="true" />,
          children: panels.overview,
        },
        {
          key: 'files',
          label: t('workbench.detailsTabs.files'),
          icon: <FolderOpen size={17} aria-hidden="true" />,
          children: panels.files,
        },
        {
          key: 'system',
          label: t('workbench.detailsTabs.systemInfo'),
          icon: <Cpu size={17} aria-hidden="true" />,
          children: panels.system,
        },
        {
          key: 'monitor',
          label: t('workbench.detailsTabs.systemMonitor'),
          icon: <Monitor size={17} aria-hidden="true" />,
          children: panels.monitor,
        },
        {
          key: 'processes',
          label: t('workbench.detailsTabs.processes'),
          icon: <Activity size={17} aria-hidden="true" />,
          children: panels.processes,
        },
        {
          key: 'services',
          label: t('workbench.detailsTabs.services'),
          icon: <Wrench size={17} aria-hidden="true" />,
          children: panels.services,
        },
        {
          key: 'crontab',
          label: t('workbench.detailsTabs.crontab'),
          icon: <CalendarClock size={17} aria-hidden="true" />,
          children: panels.crontab,
        },
        {
          key: 'docker',
          label: t('workbench.detailsTabs.docker'),
          icon: <Boxes size={17} aria-hidden="true" />,
          children: panels.docker,
        },
        {
          key: 'firewall',
          label: t('workbench.detailsTabs.firewall'),
          icon: <Shield size={17} aria-hidden="true" />,
          children: panels.firewall,
        },
        {
          key: 'forwards',
          label: t('workbench.detailsTabs.forwards'),
          icon: <Cable size={17} aria-hidden="true" />,
          children: panels.forwards,
        },
        {
          key: 'aliases',
          label: t('workbench.detailsTabs.aliases'),
          icon: <Command size={17} aria-hidden="true" />,
          children: panels.aliases,
        },
        {
          key: 'snippets',
          label: t('workbench.detailsTabs.snippets'),
          icon: <Code2 size={17} aria-hidden="true" />,
          children: panels.snippets,
        },
      ]}
    />
  )
}
