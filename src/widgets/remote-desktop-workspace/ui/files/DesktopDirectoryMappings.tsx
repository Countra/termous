import { App, Button, Checkbox, Popconfirm, Tag, Tooltip } from 'antd'
import { Folder, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import type { DesktopFilesGateway } from '#features/remote-desktop'
import { confirmDialogStyles, termousPopconfirmProps } from '#shared/ui'
import type { useDesktopFiles } from '../../model/useDesktopFiles'
import { DesktopSharePath } from './DesktopSharePath'
import section from './DesktopFileSection.module.scss'
import styles from './DesktopFileTools.module.scss'

export function DesktopDirectoryMappings({ api, session, operations, unavailable }: {
  api: DesktopFilesGateway; session: RemoteDesktopSession; operations: ReturnType<typeof useDesktopFiles>; unavailable: boolean
}) {
  const { t } = useTranslation()
  const { modal } = App.useApp()
  const { state, busy, run, withGrant } = operations
  const add = () => modal.confirm({ title: t('remoteDesktop.files.addMapping'), content: t('remoteDesktop.files.mappingConsent'), centered: true,
    className: confirmDialogStyles.modal, rootClassName: confirmDialogStyles['modal-root'],
    okText: t('remoteDesktop.files.selectFolder'), cancelText: t('app.cancel'),
    onOk: () => run(() => withGrant('directories', false, grant => api.mapping(session.id, session.connection_generation, 'add', grant))),
  })
  return <section className={section.section}>
    <div className={section.heading}><div><h3>{t('remoteDesktop.files.mappings')}</h3><p>{t('remoteDesktop.files.mappingNote')}</p></div>
      <Button type="primary" icon={<Plus size={15} />} disabled={!state?.capabilities.directory_mapping || unavailable || busy} onClick={add}>{t('remoteDesktop.files.addMapping')}</Button>
    </div>
    <div className={styles['mapping-list']}>
      {!state?.mappings.length && <div className={section.empty}><Folder size={30} /><h3>{t('remoteDesktop.files.mappingEmpty')}</h3><p>{t('remoteDesktop.files.mappingEmptyHint')}</p></div>}
      {state?.mappings.map(mapping => {
        const changing = ['preparing', 'registering', 'pausing', 'resuming', 'revoking'].includes(mapping.state)
        return <article className={styles.mapping} key={mapping.id}>
          <div className={styles['mapping-title']}><span className={styles['mapping-icon']}><Folder size={20} /></span><div><strong>{mapping.label}</strong><span>{t('remoteDesktop.files.readWrite')}</span></div>
            <Tag color={mapping.state === 'registered' ? 'success' : mapping.state === 'failed' ? 'error' : undefined}>{t(`remoteDesktop.files.states.${mapping.state}`, { defaultValue: mapping.state })}</Tag>
          </div>
          {mapping.target_path && <DesktopSharePath path={mapping.target_path} />}
          {mapping.error_code && <code role="alert">{mapping.error_code}</code>}
          <div className={styles['mapping-footer']}>
            <Tooltip title={t('remoteDesktop.files.rememberMapping')}><Checkbox checked={mapping.remembered} disabled={busy || unavailable || changing || (!mapping.remembered && mapping.state !== 'registered')} onChange={event => void run(() => api.rememberMapping(session.id, session.connection_generation, mapping.id, event.target.checked))}>{t('remoteDesktop.files.rememberShort')}</Checkbox></Tooltip>
            <div className={section.actions}>
              <Button size="small" loading={changing} disabled={busy || unavailable || !['registered', 'paused'].includes(mapping.state)} onClick={() => void run(() => api.mapping(session.id, session.connection_generation, mapping.state === 'paused' ? 'resume' : 'pause', mapping.id))}>{t(`remoteDesktop.files.${mapping.state === 'paused' ? 'resume' : 'pause'}`)}</Button>
              <Popconfirm {...termousPopconfirmProps} title={t('remoteDesktop.files.removeMappingConfirm')} onConfirm={() => run(() => api.mapping(session.id, session.connection_generation, 'remove', mapping.id))}><Button size="small" type="text" danger disabled={busy || changing}>{t('remoteDesktop.files.remove')}</Button></Popconfirm>
            </div>
          </div>
        </article>
      })}
    </div>
  </section>
}
