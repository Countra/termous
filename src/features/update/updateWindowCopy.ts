import type { UpdateInstallConfirmation } from '../../../electron/updateRuntime'
import type { UpdateWindowLanguage } from '../../../electron/updateWindow'
import type { UpdateErrorCode, UpdateSnapshot } from '../../../electron/updateTypes'
import type { UpdateWindowPrimaryAction } from './updateWindowUiState'

export type UpdateWindowText = ReturnType<typeof windowCopy>

export function primaryActionLabel(
  action: UpdateWindowPrimaryAction,
  text: UpdateWindowText,
  confirmation: UpdateInstallConfirmation | null,
) {
  const requiresClose = Boolean(
    confirmation
    && (
      !confirmation.summary.transfers_complete
      || confirmation.summary.ssh_sessions
        + confirmation.summary.file_sessions
        + confirmation.summary.forwards
        + confirmation.summary.transfers > 0
    ),
  )
  const labels: Record<UpdateWindowPrimaryAction, string> = {
    download: text.startDownload,
    cancel: text.cancelDownload,
    install: confirmation
      ? requiresClose ? text.closeAndInstall : text.installRestart
      : text.readingImpact,
    retry_download: text.retryDownload,
    retry_install: confirmation
      ? requiresClose ? text.closeAndRetryInstall : text.retryInstall
      : text.readingImpact,
    open_releases: text.openReleases,
    none: '',
  }
  return labels[action]
}

export function phaseTitle(snapshot: UpdateSnapshot, text: UpdateWindowText) {
  const titles: Record<UpdateSnapshot['phase'], string> = {
    unsupported: text.unsupported,
    idle: text.ready,
    checking: text.checking,
    up_to_date: text.upToDate,
    available: text.readyToDownload,
    downloading: text.downloading,
    downloaded: text.readyToInstall,
    preparing_install: text.preparingInstall,
    installing: text.installing,
    error: text.updateFailed,
  }
  return titles[snapshot.phase]
}

export function phaseDescription(snapshot: UpdateSnapshot, text: UpdateWindowText) {
  const descriptions: Record<UpdateSnapshot['phase'], string> = {
    unsupported: text.unsupportedDescription,
    idle: text.idleDescription,
    checking: text.checkingDescription,
    up_to_date: text.upToDateDescription,
    available: text.availableDescription,
    downloading: text.downloadingDescription,
    downloaded: text.downloadedDescription,
    preparing_install: text.preparingDescription,
    installing: text.installingDescription,
    error: text.errorDescription,
  }
  return descriptions[snapshot.phase]
}

export function formatReleaseDate(
  value: string | null,
  language: UpdateWindowLanguage,
  fallback: string,
) {
  if (!value) {
    return fallback
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(timestamp)
    : fallback
}

export function errorCopy(code: UpdateErrorCode | null, language: UpdateWindowLanguage) {
  const zh: Record<UpdateErrorCode, string> = {
    UPDATE_UNSUPPORTED: '当前安装环境不支持应用内更新',
    UPDATE_CHECK_FAILED: '检查更新失败，请稍后重试',
    UPDATE_METADATA_INVALID: '更新信息无效，请查看发布页面',
    UPDATE_ASSET_NOT_FOUND: '没有找到适用于当前系统的更新包',
    UPDATE_DOWNLOAD_FAILED: '更新下载失败，可重新下载',
    UPDATE_DOWNLOAD_CANCELED: '更新下载已取消',
    UPDATE_CANCEL_FAILED: '无法取消当前下载',
    UPDATE_HASH_MISMATCH: '更新包完整性校验失败',
    UPDATE_SIGNATURE_INVALID: '更新包签名校验失败',
    UPDATE_CORE_SHUTDOWN_FAILED: '核心服务未能安全退出，尚未安装更新',
    UPDATE_INSTALL_START_FAILED: '无法启动更新安装程序',
  }
  const en: Record<UpdateErrorCode, string> = {
    UPDATE_UNSUPPORTED: 'In-app updates are unavailable for this installation.',
    UPDATE_CHECK_FAILED: 'Could not check for updates. Try again later.',
    UPDATE_METADATA_INVALID: 'Update information is invalid. View the release page.',
    UPDATE_ASSET_NOT_FOUND: 'No update package matches this system.',
    UPDATE_DOWNLOAD_FAILED: 'The update could not be downloaded. You can retry.',
    UPDATE_DOWNLOAD_CANCELED: 'The update download was cancelled.',
    UPDATE_CANCEL_FAILED: 'The current download could not be cancelled.',
    UPDATE_HASH_MISMATCH: 'The update package failed its integrity check.',
    UPDATE_SIGNATURE_INVALID: 'The update package signature is invalid.',
    UPDATE_CORE_SHUTDOWN_FAILED: 'The core service did not exit safely. Nothing was installed.',
    UPDATE_INSTALL_START_FAILED: 'The update installer could not be started.',
  }
  if (!code) {
    return language === 'zh-CN' ? '更新操作失败' : 'The update operation failed.'
  }
  return (language === 'zh-CN' ? zh : en)[code]
}

export function windowCopy(language: UpdateWindowLanguage) {
  if (language === 'en-US') {
    return {
      softwareUpdate: 'Software Update',
      minimize: 'Minimize',
      close: 'Close',
      later: 'Later',
      versionAvailable: 'Termous update',
      versionRoute: 'Current and target version',
      currentVersion: 'Current',
      targetVersion: 'Available',
      stableRelease: 'Stable release',
      dateUnknown: 'Release date unavailable',
      trustedSource: 'Trusted source',
      viewRelease: 'View release',
      releaseNotes: 'What’s new',
      releaseNotesHint: 'Release notes from GitHub',
      noReleaseNotes: 'No release notes were provided for this version.',
      downloadProgress: 'Update download progress',
      downloaded: 'Downloaded',
      speed: 'Speed',
      remaining: 'Remaining',
      sshSessions: 'SSH',
      fileSessions: 'SFTP',
      forwards: 'Forwards',
      transfers: 'Transfers',
      unknownCount: 'Pending',
      transferSummaryIncomplete: 'Transfer activity is still being verified. Installation will close all active work safely.',
      activeWorkWillClose: 'Active connections and transfers will close before installation.',
      noActiveWork: 'No active workspace tasks will be interrupted.',
      readingImpact: 'Reading installation impact…',
      summaryUnavailable: 'Could not read installation impact. Retry to continue.',
      retrySummary: 'Retry',
      unsupported: 'Update unavailable',
      ready: 'Ready',
      checking: 'Checking for updates',
      upToDate: 'You’re up to date',
      readyToDownload: 'Ready to download',
      downloading: 'Downloading update',
      readyToInstall: 'Ready to install',
      preparingInstall: 'Preparing to install',
      installing: 'Starting installer',
      updateFailed: 'Update needs attention',
      unsupportedDescription: 'Use GitHub Releases to update this installation.',
      idleDescription: 'Update details will appear here when a release is available.',
      checkingDescription: 'Contacting the trusted GitHub release source.',
      upToDateDescription: 'This is the latest available version.',
      availableDescription: 'Download and verify the update without leaving Termous.',
      downloadingDescription: 'You may close this window while the download continues.',
      downloadedDescription: 'Review the impact, then install and restart.',
      preparingDescription: 'Closing active resources safely before installation.',
      installingDescription: 'Termous will close when the installer is ready.',
      errorDescription: 'No changes were made to the current installation.',
      startDownload: 'Start update',
      cancelDownload: 'Cancel download',
      installRestart: 'Install and restart',
      closeAndInstall: 'Close connections and install',
      retryDownload: 'Retry download',
      retryInstall: 'Retry install',
      closeAndRetryInstall: 'Close connections and retry',
      openReleases: 'Open Releases',
      bridgeUnavailable: 'Update controls are unavailable in this environment.',
      bootstrapFailed: 'Could not load the update window state.',
      prepareFailed: 'Could not prepare installation details. Try again.',
      impactChanged: 'Active work changed. Review the latest impact before installing.',
      installFailed: 'The installer could not be started. Nothing was changed.',
      actionFailed: 'The update action failed. Try again.',
      openReleaseFailed: 'Could not open GitHub Releases.',
    }
  }
  return {
    softwareUpdate: '软件更新',
    minimize: '最小化',
    close: '关闭',
    later: '稍后',
    versionAvailable: 'Termous 更新',
    versionRoute: '当前版本与目标版本',
    currentVersion: '当前版本',
    targetVersion: '可用版本',
    stableRelease: '稳定版本',
    dateUnknown: '发布日期未知',
    trustedSource: '可信更新源',
    viewRelease: '查看发布页',
    releaseNotes: '本次更新',
    releaseNotesHint: '来自 GitHub Release 的更新说明',
    noReleaseNotes: '此版本未提供更新说明。',
    downloadProgress: '更新下载进度',
    downloaded: '已下载',
    speed: '实时速度',
    remaining: '预计剩余',
    sshSessions: 'SSH 会话',
    fileSessions: 'SFTP 会话',
    forwards: '端口转发',
    transfers: '传输任务',
    unknownCount: '待确认',
    transferSummaryIncomplete: '仍在确认传输任务状态；安装时会继续安全关闭全部活动任务。',
    activeWorkWillClose: '安装前将安全关闭正在进行的连接与传输。',
    noActiveWork: '当前没有会被中断的工作区任务。',
    readingImpact: '正在读取安装影响…',
    summaryUnavailable: '暂时无法读取安装影响，请重试后继续。',
    retrySummary: '重试',
    unsupported: '当前环境不支持更新',
    ready: '已就绪',
    checking: '正在检查更新',
    upToDate: '已是最新版本',
    readyToDownload: '更新可供下载',
    downloading: '正在下载更新',
    readyToInstall: '更新可以安装',
    preparingInstall: '正在准备安装',
    installing: '正在启动安装程序',
    updateFailed: '更新需要处理',
    unsupportedDescription: '请通过 GitHub Releases 更新当前安装。',
    idleDescription: '发现可用版本后，更新信息会显示在这里。',
    checkingDescription: '正在连接可信的 GitHub Release 更新源。',
    upToDateDescription: '当前已经是最新可用版本。',
    availableDescription: '无需离开 Termous，即可下载并校验更新。',
    downloadingDescription: '关闭此窗口不会中断后台下载。',
    downloadedDescription: '确认安装影响后即可安装并重新启动。',
    preparingDescription: '正在安全关闭活动资源，为安装做准备。',
    installingDescription: '安装程序就绪后 Termous 将自动关闭。',
    errorDescription: '当前安装未发生任何更改。',
    startDownload: '立即更新',
    cancelDownload: '取消下载',
    installRestart: '安装并重新启动',
    closeAndInstall: '关闭连接并安装',
    retryDownload: '重新下载',
    retryInstall: '重试安装',
    closeAndRetryInstall: '关闭连接并重试',
    openReleases: '打开发布页',
    bridgeUnavailable: '当前环境无法使用更新控制功能。',
    bootstrapFailed: '无法读取更新窗口状态。',
    prepareFailed: '无法读取安装影响，请重试。',
    impactChanged: '活动任务已变化，请确认最新影响后再次安装。',
    installFailed: '无法启动安装程序，当前安装未发生更改。',
    actionFailed: '更新操作失败，请重试。',
    openReleaseFailed: '无法打开 GitHub Releases。',
  }
}
