import { useRef, useState } from 'react'
import { App as AntdApp, Tooltip } from 'antd'
import { LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { resolveGlobalUpdateStatus } from './updateRuntimeState'
import { useUpdateRuntime } from './useUpdateRuntime'
import './brand-version-control.css'

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

export function BrandVersionControl({
  appVersion,
  collapsed,
  className,
}: BrandVersionControlProps) {
  const { t, i18n } = useTranslation()
  const { notification } = AntdApp.useApp()
  const { snapshot, openUpdateWindow } = useUpdateRuntime()
  const [opening, setOpening] = useState(false)
  const openingRef = useRef(false)
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

  const handleOpen = async () => {
    if (openingRef.current) {
      return
    }
    openingRef.current = true
    setOpening(true)
    try {
      const opened = await openUpdateWindow()
      if (!opened) {
        throw new Error('about_window_not_opened')
      }
    } catch {
      console.error('[termous:update] 打开关于窗口失败')
      notification.error({
        key: 'termous-about-window-open-failed',
        title: t('update.global.openFailed', {
          defaultValue: chinese
            ? '无法打开关于 Termous'
            : 'Could not open About Termous',
        }),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
    } finally {
      openingRef.current = false
      setOpening(false)
    }
  }

  return (
    <Tooltip title={tooltip} placement={collapsed ? 'right' : 'bottom'}>
      <button
        type="button"
        className={[
          'brand-version-control',
          `is-${kind}`,
          opening ? 'is-opening' : '',
          className,
        ].filter(Boolean).join(' ')}
        aria-busy={opening}
        aria-label={tooltip}
        data-update-status={kind}
        onClick={() => void handleOpen()}
      >
        <span className="brand-version-control__label">
          v{appVersion}
        </span>
        <span
          className="brand-version-control__status"
          aria-hidden="true"
        >
          {opening || kind === 'checking' || kind === 'downloading' ? (
            <LoaderCircle
              className="brand-version-control__spinner"
              size={10}
              strokeWidth={2.5}
            />
          ) : (
            <span className="brand-version-control__dot" />
          )}
        </span>
      </button>
    </Tooltip>
  )
}
