import { useState } from 'react'
import { Button, Tooltip } from 'antd'
import {
  CircleCheck,
  Download,
  LoaderCircle,
  TriangleAlert,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { resolveGlobalUpdateStatus } from './updateRuntimeState'
import { useUpdateRuntime } from './useUpdateRuntime'
import './update-status-button.css'

interface UpdateStatusButtonProps {
  className?: string
}

export function UpdateStatusButton({
  className,
}: UpdateStatusButtonProps) {
  const { t, i18n } = useTranslation()
  const { snapshot, openUpdateWindow } = useUpdateRuntime()
  const [opening, setOpening] = useState(false)
  const status = resolveGlobalUpdateStatus(snapshot)

  if (!snapshot || !status) {
    return null
  }

  const chinese = i18n.resolvedLanguage?.startsWith('zh') ?? false
  const version = status.version?.trim() || snapshot.current_version
  const percent = Math.round(status.progressPercent ?? 0)
  const errorReason = t(`update.errors.${snapshot.error_code ?? 'unknown'}`, {
    defaultValue: chinese
      ? snapshot.error_message || '更新需要处理'
      : 'The update needs your attention.',
  })

  const presentation = status.kind === 'available'
    ? {
        icon: <Download size={16} strokeWidth={2.2} aria-hidden="true" />,
        label: t('update.global.available', {
          defaultValue: chinese ? '新版本' : 'New version',
        }),
        tooltip: t('update.global.availableTooltip', {
          version,
          defaultValue: chinese
            ? `Termous ${version} 可下载，点击查看更新`
            : `Termous ${version} is available. Open update details.`,
        }),
      }
    : status.kind === 'downloading'
      ? {
          icon: (
            <LoaderCircle
              className="update-status-button__spinner"
              size={16}
              strokeWidth={2.2}
              aria-hidden="true"
            />
          ),
          label: t('update.global.downloading', {
            percent,
            defaultValue: `${percent}%`,
          }),
          tooltip: t('update.global.downloadingTooltip', {
            version,
            percent,
            defaultValue: chinese
              ? `Termous ${version} 正在下载：${percent}%`
              : `Downloading Termous ${version}: ${percent}%`,
          }),
        }
      : status.kind === 'downloaded'
        ? {
            icon: <CircleCheck size={16} strokeWidth={2.2} aria-hidden="true" />,
            label: t('update.global.downloaded', {
              defaultValue: chinese ? '可安装' : 'Ready',
            }),
            tooltip: t('update.global.downloadedTooltip', {
              version,
              defaultValue: chinese
                ? `Termous ${version} 已下载，点击查看安装选项`
                : `Termous ${version} is ready to install.`,
            }),
          }
        : {
            icon: <TriangleAlert size={16} strokeWidth={2.2} aria-hidden="true" />,
            label: t('update.global.error', {
              defaultValue: chinese ? '更新失败' : 'Update issue',
            }),
            tooltip: t('update.global.errorTooltip', {
              reason: errorReason,
              defaultValue: errorReason,
            }),
          }

  const handleOpen = async () => {
    if (opening) {
      return
    }
    setOpening(true)
    try {
      await openUpdateWindow('inspect')
    } catch {
      console.error('[termous:update] 打开更新窗口失败')
    } finally {
      setOpening(false)
    }
  }

  return (
    <Tooltip title={presentation.tooltip} placement="bottom">
      <Button
        type="default"
        className={[
          'update-status-button',
          `is-${status.kind}`,
          className,
        ].filter(Boolean).join(' ')}
        aria-busy={opening}
        aria-label={presentation.tooltip}
        data-update-status={status.kind}
        onClick={() => void handleOpen()}
      >
        <span className="update-status-button__visual">
          {presentation.icon}
          <span className="update-status-button__dot" aria-hidden="true" />
        </span>
        <span
          className="update-status-button__label"
          aria-live={status.kind === 'downloading' ? 'polite' : 'off'}
          aria-atomic="true"
        >
          {presentation.label}
        </span>
      </Button>
    </Tooltip>
  )
}
