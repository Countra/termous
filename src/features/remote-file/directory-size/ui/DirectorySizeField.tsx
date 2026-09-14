import { Button, Tooltip } from 'antd'
import { Calculator, RefreshCw, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatBytes, formatDate } from '#shared/format'
import { useDirectorySizeController, type DirectorySizeGateway } from '../controller/useDirectorySizeController.ts'
import type { DirectorySizeResultCache } from '../model/DirectorySizeResultCache.ts'
import type { DirectorySizeSource } from '../model/types.ts'
import styles from './DirectorySizeField.module.scss'

interface DirectorySizeFieldProps {
  api: DirectorySizeGateway
  cache: DirectorySizeResultCache
  source: DirectorySizeSource
  enabled: boolean
  onError: (error: unknown) => void
}

export function DirectorySizeField({ api, cache, source, enabled, onError }: DirectorySizeFieldProps) {
  const { t } = useTranslation()
  const { state, calculate, cancel } = useDirectorySizeController({
    api,
    cache,
    source,
    enabled,
    onError,
  })

  if (state.status === 'running') {
    return (
      <span className={styles.field} role="status" aria-live="polite">
        <span className={styles.status}>{t('files.directorySize.calculating')}</span>
        <Tooltip title={t('files.directorySize.cancel')}>
          <Button
            type="text"
            size="small"
            className={styles['icon-button']}
            aria-label={t('files.directorySize.cancel')}
            icon={<Square size={11} fill="currentColor" aria-hidden="true" />}
            onClick={cancel}
          />
        </Tooltip>
      </span>
    )
  }

  if (state.status === 'success') {
    const value = formatBytes(state.result.total_bytes)
    const display = state.result.estimated
      ? t('files.directorySize.estimatedValue', { value })
      : value
    return (
      <span className={styles.field} role="status" aria-live="polite">
        <Tooltip title={display} placement="topRight">
          <span className={styles.value}>{display}</span>
        </Tooltip>
        <Tooltip title={t('files.directorySize.calculatedAt', {
          time: formatDate(state.result.calculated_at),
        })}>
          <Button
            type="text"
            size="small"
            className={styles['icon-button']}
            disabled={!enabled}
            aria-label={t('files.directorySize.recalculate')}
            icon={<RefreshCw size={12} aria-hidden="true" />}
            onClick={() => void calculate()}
          />
        </Tooltip>
      </span>
    )
  }

  const failed = state.status === 'error'
  return (
    <span className={styles.field} role="status" aria-live="polite">
      <span className={failed ? styles.error : styles.placeholder}>
        {failed ? t('files.directorySize.failed') : '-'}
      </span>
      <Tooltip title={enabled ? null : t('files.connectionRequired')}>
        <Button
          type="text"
          size="small"
          className={styles.action}
          disabled={!enabled}
          icon={failed
            ? <RefreshCw size={12} aria-hidden="true" />
            : <Calculator size={12} aria-hidden="true" />}
          onClick={() => void calculate()}
        >
          {t(failed ? 'files.directorySize.retry' : 'files.directorySize.calculate')}
        </Button>
      </Tooltip>
    </span>
  )
}
