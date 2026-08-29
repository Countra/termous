import type {
  UpdateErrorCode,
  UpdateInstallConfirmation,
  UpdateSnapshot,
  UpdateWindowLanguage,
} from '#common/contracts'
import type { UpdateWindowPrimaryAction } from '#entities/update'

export type UpdateWindowText = ReturnType<typeof windowCopy>

export function primaryActionLabel(
  action: UpdateWindowPrimaryAction,
  text: UpdateWindowText,
  confirmation: UpdateInstallConfirmation | null,
) {
  const labels: Record<UpdateWindowPrimaryAction, string> = {
    check: text.checkNow,
    download: text.startDownload,
    cancel: text.cancelDownload,
    install: confirmation
      ? text.installRestart
      : text.preparingInstallStatus,
    retry_download: text.retryDownload,
    retry_install: confirmation
      ? text.retryInstall
      : text.preparingInstallStatus,
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
  const descriptions: Record<UpdateSnapshot['phase'], string | null> = {
    unsupported: text.unsupportedDescription,
    idle: text.idleDescription,
    checking: text.checkingDescription,
    up_to_date: text.upToDateDescription,
    available: null,
    downloading: text.downloadingDescription,
    downloaded: null,
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
    UPDATE_METADATA_INVALID: '更新信息无效，请稍后重新检查',
    UPDATE_ASSET_NOT_FOUND: '没有找到适用于当前系统的更新包',
    UPDATE_DOWNLOAD_FAILED: '更新下载失败，可重新下载',
    UPDATE_DOWNLOAD_CANCELED: '更新下载已取消',
    UPDATE_CANCEL_FAILED: '无法取消当前下载',
    UPDATE_HASH_MISMATCH: '更新包完整性校验失败',
    UPDATE_SIGNATURE_INVALID: '更新包签名校验失败',
    UPDATE_CORE_SHUTDOWN_FAILED: '核心服务未能安全退出，尚未安装更新',
    UPDATE_INSTALL_SUMMARY_STALE: '运行状态已变化，请重新准备安装',
    UPDATE_INSTALL_START_FAILED: '无法启动更新安装程序',
  }
  const en: Record<UpdateErrorCode, string> = {
    UPDATE_UNSUPPORTED: 'In-app updates are unavailable for this installation.',
    UPDATE_CHECK_FAILED: 'Could not check for updates. Try again later.',
    UPDATE_METADATA_INVALID: 'Update information is invalid. Check again later.',
    UPDATE_ASSET_NOT_FOUND: 'No update package matches this system.',
    UPDATE_DOWNLOAD_FAILED: 'The update could not be downloaded. You can retry.',
    UPDATE_DOWNLOAD_CANCELED: 'The update download was cancelled.',
    UPDATE_CANCEL_FAILED: 'The current download could not be cancelled.',
    UPDATE_HASH_MISMATCH: 'The update package failed its integrity check.',
    UPDATE_SIGNATURE_INVALID: 'The update package signature is invalid.',
    UPDATE_CORE_SHUTDOWN_FAILED: 'The core service did not exit safely. Nothing was installed.',
    UPDATE_INSTALL_SUMMARY_STALE: 'App activity changed. Prepare the installation again.',
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
      aboutTermous: 'About Termous',
      softwareUpdate: 'Software update',
      minimize: 'Minimize',
      close: 'Close',
      later: 'Later',
      applicationVersion: 'App',
      system: 'System',
      unavailable: 'Unavailable',
      githubRelease: 'View this release on GitHub',
      versionRoute: 'Current and target version',
      currentVersion: 'Current',
      targetVersion: 'Available',
      dateUnknown: 'Update date unavailable',
      releaseNotes: 'What’s new',
      noReleaseNotes: 'No update notes were provided for this version.',
      downloadProgress: 'Update download progress',
      downloaded: 'Downloaded',
      speed: 'Speed',
      remaining: 'Remaining',
      activeWorkWillClose: 'Installing will stop active Agent tasks, disconnect current connections, stop transfers, and restart Termous.',
      preparingInstallStatus: 'Preparing installation…',
      summaryUnavailable: 'Installation could not be prepared. Retry to continue.',
      retrySummary: 'Retry',
      unsupported: 'Update unavailable',
      ready: 'Ready',
      checking: 'Checking for updates',
      upToDate: 'You’re up to date',
      readyToDownload: 'Update available',
      downloading: 'Downloading update',
      readyToInstall: 'Ready to install',
      preparingInstall: 'Preparing to install',
      installing: 'Starting installer',
      updateFailed: 'Update needs attention',
      unsupportedDescription: 'In-app updates are unavailable for this installation. Other features remain available.',
      idleDescription: 'Check whether a newer version is available.',
      checkingDescription: 'Checking for available updates.',
      upToDateDescription: 'This is the latest available version.',
      downloadingDescription: 'You may close this window while the download continues.',
      preparingDescription: 'Closing active resources safely before installation.',
      installingDescription: 'Termous will close when the installer is ready.',
      errorDescription: 'No changes were made to the current installation.',
      checkNow: 'Check for updates',
      startDownload: 'Download update',
      cancelDownload: 'Cancel download',
      installRestart: 'Install and restart',
      retryDownload: 'Retry download',
      retryInstall: 'Retry install',
      bridgeUnavailable: 'Update controls are unavailable in this environment.',
      bootstrapFailed: 'Could not load the update window state.',
      prepareFailed: 'Could not prepare the installation. Try again.',
      impactChanged: 'App activity changed. Prepare the installation again.',
      installFailed: 'The installer could not be started. Nothing was changed.',
      actionFailed: 'The update action failed. Try again.',
    }
  }
  return {
    aboutTermous: '关于 Termous',
    softwareUpdate: '软件更新',
    minimize: '最小化',
    close: '关闭',
    later: '稍后',
    applicationVersion: '应用版本',
    system: '系统',
    unavailable: '暂不可用',
    githubRelease: '在 GitHub 查看当前版本',
    versionRoute: '当前版本与目标版本',
    currentVersion: '当前版本',
    targetVersion: '可用版本',
    dateUnknown: '更新日期未知',
    releaseNotes: '本次更新',
    noReleaseNotes: '此版本未提供更新说明。',
    downloadProgress: '更新下载进度',
    downloaded: '已下载',
    speed: '实时速度',
    remaining: '预计剩余',
    activeWorkWillClose: '安装将停止活动的 Agent 任务、断开当前连接和传输，并重新启动 Termous。',
    preparingInstallStatus: '正在准备安装…',
    summaryUnavailable: '暂时无法准备安装，请重试后继续。',
    retrySummary: '重试',
    unsupported: '当前环境不支持更新',
    ready: '已就绪',
    checking: '正在检查更新',
    upToDate: '已是最新版本',
    readyToDownload: '有可用更新',
    downloading: '正在下载更新',
    readyToInstall: '准备安装',
    preparingInstall: '正在准备安装',
    installing: '正在启动安装程序',
    updateFailed: '更新需要处理',
    unsupportedDescription: '当前安装方式无法使用应用内更新，其他功能仍可正常使用。',
    idleDescription: '检查是否有可用的新版本。',
    checkingDescription: '正在检查可用更新。',
    upToDateDescription: '当前已经是最新可用版本。',
    downloadingDescription: '关闭此窗口不会中断后台下载。',
    preparingDescription: '正在安全关闭活动资源，为安装做准备。',
    installingDescription: '安装程序就绪后 Termous 将自动关闭。',
    errorDescription: '当前安装未发生任何更改。',
    checkNow: '检查更新',
    startDownload: '下载更新',
    cancelDownload: '取消下载',
    installRestart: '安装并重新启动',
    retryDownload: '重新下载',
    retryInstall: '重试安装',
    bridgeUnavailable: '当前环境无法使用更新控制功能。',
    bootstrapFailed: '无法读取更新窗口状态。',
    prepareFailed: '暂时无法准备安装，请重试。',
    impactChanged: '活动状态已变化，请重新准备安装。',
    installFailed: '无法启动安装程序，当前安装未发生更改。',
    actionFailed: '更新操作失败，请重试。',
  }
}
