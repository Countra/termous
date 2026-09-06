import { Button, Tooltip } from 'antd'
import { Check, FileKey2, FolderSync, MonitorPlay, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { HostCreationConnectionKind, HostCreationDraft, HostCreationValidation } from '../model/hostCreation.ts'
import { formatHostCreationEndpoint } from '../model/hostCreationProjection.ts'
import styles from './HostCreation.module.scss'

export interface HostDraftConnectionSelection {
  kind: HostCreationConnectionKind
  id: string
}

interface Props {
  draft: HostCreationDraft
  validation: HostCreationValidation
  busy: boolean
  onAdd: (kind: 'ssh' | 'remote_desktop') => void
  onEdit: (selection: HostDraftConnectionSelection) => void
  onDelete: (kind: 'ssh' | 'remote_desktop', id: string) => void
  onSetDefault: (kind: HostCreationConnectionKind, id: string) => void
}

export function HostDraftConnectionCatalog({ draft, validation, busy, onAdd, onEdit, onDelete, onSetDefault }: Props) {
  const { t } = useTranslation()
  const renderRow = (kind: HostCreationConnectionKind, id: string, name: string, detail: string, isDefault: boolean) => {
    const incomplete = validation.incomplete[kind].includes(id)
    const title = name.trim() || t('hosts.creation.unnamed')
    return (
      <div className={styles.row} key={id}>
        <button className={styles['row-main']} data-draft-connection={`${kind}:${id}`} disabled={busy} onClick={() => onEdit({ kind, id })}>
          <span className={styles['row-title']}><strong>{title}</strong>{isDefault ? <small>{t('hosts.access.default')}</small> : null}</span>
          {detail ? <span className={styles.detail}>{detail}</span> : null}
        </button>
        <span className={styles.status} data-incomplete={incomplete}>{t(incomplete ? 'hosts.creation.incomplete' : 'hosts.creation.draft')}</span>
        <div className={styles['row-actions']}>
          <Tooltip title={t(isDefault ? 'hosts.access.default' : 'hosts.access.setDefault')}>
            <Button type="text" size="small" disabled={busy || isDefault}
              aria-label={t('hosts.creation.defaultAction', { name: title })}
              icon={isDefault ? <Check size={14} /> : <Star size={14} />} onClick={() => onSetDefault(kind, id)} />
          </Tooltip>
          <Tooltip title={t('app.edit')}>
            <Button type="text" size="small" disabled={busy} icon={<Pencil size={14} />}
              aria-label={t('hosts.creation.editAction', { name: title })} onClick={() => onEdit({ kind, id })} />
          </Tooltip>
          {kind !== 'file' ? <Tooltip title={t('app.delete')}>
            <Button type="text" size="small" danger disabled={busy} icon={<Trash2 size={14} />}
              aria-label={t('hosts.creation.deleteAction', { name: title })} onClick={() => onDelete(kind, id)} />
          </Tooltip> : null}
        </div>
      </div>
    )
  }
  return (
    <div className={styles.catalog}>
      <DraftSection title={t('hosts.access.ssh.title')} icon={<FileKey2 size={16} />} count={draft.ssh.length}
        empty={t('hosts.access.ssh.empty')} action={<Button size="small" disabled={busy || draft.ssh.length >= 32}
          icon={<Plus size={14} />} onClick={() => onAdd('ssh')}>{t('hosts.access.ssh.add')}</Button>}>
        {draft.ssh.map((item) => renderRow('ssh', item.id, item.draft.name,
          item.draft.address ? `${item.draft.username}@${formatHostCreationEndpoint(item.draft.address, item.draft.port)}` : '', item.isDefault))}
      </DraftSection>
      <DraftSection title={t('hosts.access.file.title')} icon={<FolderSync size={16} />} count={draft.ssh.length}
        empty={t('hosts.creation.fileEmpty')}>
        {draft.ssh.map((item) => renderRow('file', item.id, item.fileName,
          `SFTP · ${item.draft.name.trim() || t('hosts.creation.unnamed')}`, item.fileIsDefault))}
      </DraftSection>
      <DraftSection title={t('hosts.access.desktop.title')} icon={<MonitorPlay size={16} />} count={draft.remoteDesktops.length}
        empty={t('hosts.access.desktop.empty')} action={<Button size="small" disabled={busy || draft.remoteDesktops.length >= 32}
          icon={<Plus size={14} />} onClick={() => onAdd('remote_desktop')}>{t('hosts.access.desktop.add')}</Button>}>
        {draft.remoteDesktops.map((item) => renderRow('remote_desktop', item.id, item.draft.name,
          item.draft.vnc.target_host ? `VNC · ${formatHostCreationEndpoint(item.draft.vnc.target_host, item.draft.vnc.port)}` : '', item.isDefault))}
      </DraftSection>
    </div>
  )
}

function DraftSection({ title, icon, count, empty, action, children }: {
  title: string; icon: ReactNode; count: number; empty: string; action?: ReactNode; children: ReactNode
}) {
  const id = useId()
  return (
    <section className={styles.section} aria-labelledby={id}>
      <div className={styles['section-header']}>
        <span className={styles['section-icon']}>{icon}</span><h3 id={id}>{title}</h3><small>{count}</small>{action}
      </div>
      {count ? <div className={styles.rows}>{children}</div> : <p className={styles.empty}>{empty}</p>}
    </section>
  )
}
