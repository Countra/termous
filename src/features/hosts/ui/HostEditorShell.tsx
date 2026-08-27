import { Alert, Button } from 'antd'
import { ArrowLeft, Info, Network, RotateCcw } from 'lucide-react'
import { useId, type ReactNode, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { HostAvatar } from '#entities/host'
import {
  ConnectionActionButton,
  EditorModeContext,
  ManagementFilterTabs,
  ManagementPanel,
} from '#shared/ui'
import styles from './HostEditorShell.module.scss'

export type HostEditorSection = 'asset' | 'connections'

interface HostEditorActions {
  leading?: ReactNode
  saveLabel: string
  saveIcon: ReactNode
  saveDisabled: boolean
  onDiscard: () => void
  onSave: () => void
}

interface HostEditorShellProps {
  mode: 'create' | 'edit'
  title: string
  iconId: string
  getHostIconUrl: (iconId: string) => string
  activeSection: HostEditorSection
  dirty: boolean
  busy: boolean
  children: ReactNode
  actions?: HostEditorActions
  error?: string
  contentRef?: Ref<HTMLDivElement>
  onBack: () => void
  onSectionChange: (section: HostEditorSection) => void
}

export function HostEditorShell({
  mode,
  title,
  iconId,
  getHostIconUrl,
  activeSection,
  dirty,
  busy,
  children,
  actions,
  error,
  contentRef,
  onBack,
  onSectionChange,
}: HostEditorShellProps) {
  const { t } = useTranslation()
  const showSyncState = mode === 'edit' || dirty
  const navigationId = useId()
  const activeSectionLabelId = `${navigationId}-${activeSection}-label`

  return (
    <ManagementPanel
      className={styles.panel}
      bodyClassName={styles.body}
      header={(
        <div className={`${styles.header} host-editor-heading`}>
          <Button
            type="text"
            className={styles.back}
            icon={<ArrowLeft size={16} />}
            aria-label={t('hosts.backToList')}
            disabled={busy}
            onClick={onBack}
          />
          <HostAvatar
            host={{ name: title, icon_id: iconId }}
            getIconUrl={getHostIconUrl}
            size={40}
            iconSize={19}
          />
          <EditorModeContext
            className={styles.identity}
            mode={mode}
            label={t(mode === 'create' ? 'app.add' : 'app.edit')}
            title={<h2>{title}</h2>}
            metaTrailing={showSyncState ? (
              <span
                className={`${styles['sync-state']} ${dirty ? styles.dirty : ''}`}
                role="status"
                aria-live="polite"
                data-host-editor-sync-state
              >
                <i aria-hidden="true" />
                {t(dirty ? 'hosts.unsaved' : 'hosts.saved')}
              </span>
            ) : undefined}
          />
          <ManagementFilterTabs
            className={styles.tabs}
            activeKey={activeSection}
            items={[
              {
                key: 'asset',
                disabled: busy,
                label: <span id={`${navigationId}-asset-label`} className={styles['tab-label']}><Info size={13} />{t('hosts.access.hostInfo')}</span>,
              },
              {
                key: 'connections',
                disabled: busy,
                label: <span id={`${navigationId}-connections-label`} className={styles['tab-label']}><Network size={13} />{t('hosts.access.connectionConfig')}</span>,
              },
            ]}
            onChange={(key) => {
              if (!busy) onSectionChange(key as HostEditorSection)
            }}
          />
        </div>
      )}
      footer={actions ? (
        <div className={styles.footer}>
          <span className={styles['footer-leading']}>{actions.leading}</span>
          <div className={styles['footer-actions']}>
            <Button
              icon={<RotateCcw size={14} />}
              disabled={busy || !dirty}
              onClick={actions.onDiscard}
            >
              {t('hosts.discard')}
            </Button>
            <ConnectionActionButton
              icon={actions.saveIcon}
              loading={busy}
              disabled={busy || actions.saveDisabled}
              onClick={actions.onSave}
            >
              {actions.saveLabel}
            </ConnectionActionButton>
          </div>
        </div>
      ) : undefined}
    >
      {error ? (
        <Alert className={styles.alert} type="error" showIcon title={error} />
      ) : null}
      <div
        ref={contentRef}
        className={styles.content}
        role="region"
        aria-labelledby={activeSectionLabelId}
        tabIndex={-1}
      >
        {children}
      </div>
    </ManagementPanel>
  )
}
