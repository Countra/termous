import { Button, Tooltip } from 'antd'
import { ArrowUp, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { resolveGlobalUpdateStatus } from '#entities/update'
import { useUpdateRuntime } from '../model/updateRuntime'
import { useOpenUpdateWindow } from '../model/useOpenUpdateWindow'
import styles from './BrandVersionControl.module.scss'

interface BrandVersionControlProps {
  appVersion: string
  collapsed: boolean
  className?: string
}

type BrandUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

const statusClassNames: Record<BrandUpdateStatus, string> = {
  idle: styles.idle,
  checking: styles.checking,
  available: styles.available,
  downloading: styles.downloading,
  downloaded: styles.downloaded,
  error: styles.error,
}

export function BrandVersionControl({
  appVersion,
  collapsed,
  className,
}: BrandVersionControlProps) {
  const { t, i18n } = useTranslation()
  const { snapshot } = useUpdateRuntime()
  const { opening, open } = useOpenUpdateWindow()
  const status = resolveGlobalUpdateStatus(snapshot)
  const chinese = i18n.resolvedLanguage?.startsWith('zh') ?? false
  const kind: BrandUpdateStatus = snapshot?.phase === 'checking'
    ? 'checking'
    : status?.kind ?? 'idle'
  const version = status?.version?.trim()
    || snapshot?.available_version?.trim()
    || appVersion
  const errorReason = t(`update.errors.${snapshot?.error_code ?? 'unknown'}`, {
    defaultValue: chinese
      ? snapshot?.error_message || '更新需要处理'
      : 'The update needs your attention.',
  })
  const tooltip = kind === 'checking'
    ? t('update.global.checkingTooltip', {
        defaultValue: chinese ? '正在检查更新' : 'Checking for updates',
      })
    : kind === 'available'
      ? t('update.global.availableTooltip', {
          version,
          defaultValue: chinese
            ? `Termous ${version} 可下载，点击查看更新`
            : `Termous ${version} is available. Open update details.`,
        })
      : kind === 'downloading'
        ? t('update.global.downloadingTooltip', {
            version,
            defaultValue: chinese
              ? `Termous ${version} 正在下载，点击查看状态`
              : `Termous ${version} is downloading. Open update status.`,
          })
        : kind === 'downloaded'
          ? t('update.global.downloadedTooltip', {
              version,
              defaultValue: chinese
                ? `Termous ${version} 已下载，点击查看安装选项`
                : `Termous ${version} is ready to install.`,
            })
          : kind === 'error'
            ? t('update.global.errorTooltip', {
                reason: errorReason,
                defaultValue: errorReason,
              })
            : t('update.global.aboutTooltip', {
                defaultValue: chinese ? '关于 Termous' : 'About Termous',
              })

  return (
    <Tooltip
      title={tooltip}
      placement={collapsed ? 'right' : 'bottomLeft'}
      mouseEnterDelay={0.35}
    >
      <Button
        type="text"
        size="small"
        className={[
          styles.root,
          statusClassNames[kind],
          collapsed ? styles.collapsed : '',
          opening ? styles.opening : '',
          className,
        ].filter(Boolean).join(' ')}
        aria-busy={opening}
        aria-label={tooltip}
        data-update-status={kind}
        onClick={() => void open()}
      >
        <span className={styles.label}>
          <span className={styles.prefix}>v</span>
          <span className={styles.value}>{appVersion}</span>
        </span>
        {kind === 'available' ? (
          <span className={styles['update-mark']} aria-hidden="true">
            {opening
              ? <LoaderCircle size={9} strokeWidth={2.5} />
              : <ArrowUp size={9} strokeWidth={2.8} />}
          </span>
        ) : null}
      </Button>
    </Tooltip>
  )
}
