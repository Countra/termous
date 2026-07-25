import {
  existsSync,
  readFileSync,
} from 'node:fs'
import path from 'node:path'
import {
  app,
  BrowserWindow,
  session,
} from 'electron'
import { AppExitCoordinator } from './appExitCoordinator'
import { createElectronUpdaterEngine } from './electronUpdaterEngine'
import { ApplicationUpdateRuntime } from './updateRuntime'
import {
  runUpdateSimulationAcceptance,
  writeUpdateSimulationReport,
} from './updateSimulationAcceptance'
import { prepareUpdateSimulationDirectories } from './updateSimulationFilesystem'
import { validateUpdateSimulationInputs } from './updateSimulationFixtureValidation'
import { installUpdateSimulationNetworkGuard } from './updateSimulationSecurity'

const expectedPackageName = 'termous-update-simulation'
const expectedBaselineVersion = '0.0.1'
const expectedFeedURL = 'http://127.0.0.1:18991'
const simulationMarkerName = 'update-simulation-profile.marker'
const simulationMarkerValue = 'termous-update-simulation-v1'
const scenarioTimeoutMs = 90_000

const simulation = initializeSimulationPaths()
let updateRuntime: ApplicationUpdateRuntime | null = null
let shuttingDown = false

function initializeSimulationPaths() {
  const markerPath = path.join(process.resourcesPath, simulationMarkerName)
  if (
    !app.isPackaged
    || app.getName() !== expectedPackageName
    || app.getVersion() !== expectedBaselineVersion
    || !existsSync(markerPath)
    || readFileSync(markerPath, 'utf8').trim() !== simulationMarkerValue
  ) {
    throw new Error('更新模拟只能在专用的 0.0.1 隔离包内运行')
  }

  const root = requireAbsolutePath(
    process.env.TERMOUS_UPDATE_SIMULATION_ROOT,
    'TERMOUS_UPDATE_SIMULATION_ROOT',
  )
  const feedRoot = requireAbsolutePath(
    process.env.TERMOUS_UPDATE_SIMULATION_FEED_ROOT,
    'TERMOUS_UPDATE_SIMULATION_FEED_ROOT',
  )
  const controlToken = process.env.TERMOUS_UPDATE_SIMULATION_TOKEN
  if (!controlToken || controlToken.length < 24) {
    throw new Error('TERMOUS_UPDATE_SIMULATION_TOKEN 无效')
  }

  const paths = {
    ...prepareUpdateSimulationDirectories(root),
    feedRoot,
    controlToken,
  }
  app.setPath('userData', paths.userData)
  app.setPath('sessionData', paths.sessionData)
  app.setPath('crashDumps', paths.crashDumps)
  app.setAppLogsPath(paths.logs)
  // electron-updater 在 Windows 从 LOCALAPPDATA 派生缓存根，专用进程必须在创建 updater 前覆盖。
  process.env.LOCALAPPDATA = paths.cacheRoot
  return paths
}

app.on('window-all-closed', () => {
  // 模拟验收在更新窗口关闭后仍需继续下载并验证状态恢复。
})

app.on('before-quit', () => {
  shuttingDown = true
  updateRuntime?.dispose()
})

app.whenReady().then(async () => {
  try {
    const blockedNetworkRequests: string[] = []
    const guardOptions = {
      expectedFeedURL,
      onBlocked: (url: string) => {
        blockedNetworkRequests.push(url)
        logEvent('update_simulation_network_blocked', {
          origin: safeURLOrigin(url),
        })
      },
    }
    await Promise.all([
      installUpdateSimulationNetworkGuard(session.defaultSession, guardOptions),
      installUpdateSimulationNetworkGuard(
        session.fromPartition('electron-updater', { cache: false }),
        guardOptions,
      ),
    ])
    const validatedAsset = await validateUpdateSimulationInputs(
      simulation.feedRoot,
      process.resourcesPath,
      expectedFeedURL,
    )
    const downloadedFiles: string[] = []
    const exitCoordinator = new AppExitCoordinator({
      shutdownCore: async () => true,
      prepareForExit: () => undefined,
      recoverAfterFailedUpdateInstall: async () => true,
      closeAllWindows: () => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.destroy()
        }
      },
      quitApplication: () => app.quit(),
      reportError: (event) => logEvent(event),
    })
    const engine = createElectronUpdaterEngine({
      launchInstall: () => {
        throw new Error('simulation_install_blocked')
      },
      onDownloadedFiles: (paths) => {
        downloadedFiles.splice(0, downloadedFiles.length, ...paths)
      },
    })
    updateRuntime = await ApplicationUpdateRuntime.create({
      engine,
      exitCoordinator,
      getMainWindow: () => null,
      isTrustedMainSender: () => false,
      rendererFilePath: path.join(process.resourcesPath, 'app.asar', 'dist', 'index.html'),
      updatePreloadPath: path.join(
        process.resourcesPath,
        'app.asar',
        'dist-electron',
        'update-preload.cjs',
      ),
      iconPath: path.join(process.resourcesPath, 'app.asar', 'dist', 'termous-icon.png'),
      initialTheme: 'dark',
      initialLanguage: 'zh-CN',
      getApplicationInfo: async () => ({
        product_name: 'Termous Update Simulation',
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        packaged: app.isPackaged,
      }),
      logger: {
        info: logEvent,
        error: logEvent,
      },
    })

    const report = await withTimeout(
      runUpdateSimulationAcceptance({
        runtime: updateRuntime,
        downloadedFiles,
        context: simulation,
        expectedBaselineVersion,
        expectedFeedURL,
        getBlockedNetworkRequests: () => [...blockedNetworkRequests],
        validatedAsset,
      }),
      scenarioTimeoutMs,
      '本地更新模拟超过总预算',
    )
    await writeUpdateSimulationReport(simulation.root, report)
    logEvent('update_acceptance_ready', {
      result: report.result,
      state_events: report.state_events,
    })
  } catch (error) {
    logEvent('update_acceptance_failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    app.exit(1)
  }
}).catch((error) => {
  logEvent('update_acceptance_start_failed', {
    message: error instanceof Error ? error.message : String(error),
  })
  app.exit(1)
})

function safeURLOrigin(value: string) {
  try {
    return new URL(value).origin
  } catch {
    return 'invalid'
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
) {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  })
}

function requireAbsolutePath(value: string | undefined, name: string) {
  if (!value || !path.isAbsolute(value) || value.includes('\0')) {
    throw new Error(`${name} 必须是绝对路径`)
  }
  return path.resolve(value)
}

function logEvent(event: string, details: Record<string, unknown> = {}) {
  if (shuttingDown && event !== 'update_acceptance_failed') {
    return
  }
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...details,
  }))
}
