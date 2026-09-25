import { Button, Tooltip } from 'antd'
import { ArrowRight, HardDrive, PowerOff, RefreshCw, RotateCw, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isMountActive, isMountBusy, type MountInstance } from '#entities/mount'
import { StatusBadge } from '#shared/ui'
import { MountFailure } from './MountFailure'
import { MountUploadStatus } from './MountUploadStatus'
import styles from './Mounts.module.scss'

interface MountRuntimeProps {
  instance: MountInstance
  disabled: boolean
  sourceName: string
  onAction: (action: 'sync' | 'reconnect' | 'stop') => void
  onDiscard: () => void
}

export function MountRuntime({ instance, disabled, sourceName, onAction, onDiscard }: MountRuntimeProps) {
  const { t } = useTranslation()
  const busy = isMountBusy(instance)
  const status = instance.mounted ? 'connected' : instance.retained || instance.failure ? 'failed' : 'connecting'
  const stopLabel = t(instance.state === 'starting' ? 'mounts.cancelStart' : 'mounts.stop')
  const stopDisabled = disabled || instance.phase === 'cancelling' || (busy && instance.state !== 'starting')

  return <article className={styles['runtime-row']}>
    <div className={styles['runtime-heading']}>
      <div className={styles['runtime-identity']}>
        <span className={styles['runtime-icon']}><HardDrive size={17} aria-hidden="true" /></span>
        <div><h4>{instance.name}</h4><span>{instance.profile_id ? t('mounts.configuration') : t('mounts.temporary')}</span></div>
      </div>
      <StatusBadge
        status={status}
        label={t(`mounts.states.${instance.phase}`, { defaultValue: t(`mounts.states.${instance.state}`) })}
      />
    </div>
    <div className={styles.route}>
      <div><small>{t('mounts.source')}</small><strong title={sourceName}>{sourceName}</strong></div>
      <ArrowRight size={16} aria-hidden="true" />
      <div><small>{t('mounts.locationSection')}</small><strong title={instance.mount_point}>{instance.mount_point}</strong></div>
    </div>
    {instance.retained && !instance.mounted ? <p className={styles.hint}>{t(instance.dirty_nodes > 0 ? 'mounts.detachedHint' : 'mounts.detachedCleanHint')}</p> : null}
    <MountUploadStatus uploads={instance.uploads} />
    <div className={styles['runtime-footer']}>
      <div className={styles['runtime-meta']}>
        <span className={styles['runtime-mode']}>{t(instance.read_only ? 'mounts.readOnly' : 'mounts.readWrite')}</span>
        <span className={styles['runtime-stat']}>{t('mounts.dirty', { count: instance.dirty_nodes })}</span>
        <span className={styles['runtime-stat']}>{t('mounts.handles', { count: instance.open_handles })}</span>
        {instance.failure ? <MountFailure failure={instance.failure} /> : null}
      </div>
      {isMountActive(instance) ? <div className={styles['runtime-actions']}>
        <Tooltip title={t('mounts.sync')} mouseEnterDelay={0.25}><span className={styles['runtime-action-slot']}>
          <Button type="text" icon={<RefreshCw size={14} />} aria-label={t('mounts.sync')} disabled={disabled || busy} onClick={() => onAction('sync')} />
        </span></Tooltip>
        <Tooltip title={t('mounts.reconnect')} mouseEnterDelay={0.25}><span className={styles['runtime-action-slot']}>
          <Button type="text" icon={<RotateCw size={14} />} aria-label={t('mounts.reconnect')} disabled={disabled || busy} onClick={() => onAction('reconnect')} />
        </span></Tooltip>
        <Tooltip title={stopLabel} mouseEnterDelay={0.25}><span className={styles['runtime-action-slot']}>
          <Button type="text" className={styles['runtime-action-stop']} icon={<Square size={13} />} aria-label={stopLabel} disabled={stopDisabled} onClick={() => onAction('stop')} />
        </span></Tooltip>
        {instance.failure || instance.retained ? <Tooltip title={t('mounts.force')} mouseEnterDelay={0.25}><span className={styles['runtime-action-slot']}>
          <Button type="text" danger icon={<PowerOff size={14} />} aria-label={t('mounts.force')} disabled={disabled || busy} onClick={onDiscard} />
        </span></Tooltip> : null}
      </div> : null}
    </div>
  </article>
}
