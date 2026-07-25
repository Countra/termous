import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import type { ApplicationUpdateRuntime } from './updateRuntime'
import type { ValidatedSimulationAsset } from './updateSimulationFixtureValidation'
import type { UpdateSnapshot } from './updateTypes'

const targetVersion = '0.0.2'
const reportFileName = 'acceptance-report.json'
const windowReadyTimeoutMs = 15_000

export interface UpdateSimulationContext {
  root: string
  feedRoot: string
  controlToken: string
}

export interface UpdateSimulationAcceptanceReport {
  result: 'passed'
  current_version: string
  target_version: string
  state_events: number
  maximum_state_seq: number
  scenarios: string[]
  downloaded_asset: ValidatedSimulationAsset
}

interface AcceptanceOptions {
  context: UpdateSimulationContext
  downloadedFiles: string[]
  expectedBaselineVersion: string
  expectedFeedURL: string
  getBlockedNetworkRequests(): readonly string[]
  runtime: ApplicationUpdateRuntime
  validatedAsset: ValidatedSimulationAsset
}

interface RendererBridgeState {
  bootstrap: {
    intent: string
    snapshot: UpdateSnapshot
  }
  href: string
  release_opened: boolean
  state: UpdateSnapshot
}

export async function runUpdateSimulationAcceptance(
  options: AcceptanceOptions,
): Promise<UpdateSimulationAcceptanceReport> {
  const snapshots: UpdateSnapshot[] = []
  let lastStateSequence = options.runtime.getSnapshot().state_seq
  let invariantError: Error | null = null
  const progressByGeneration = new Map<number, {
    percent: number
    transferred: number
  }>()
  const removeListener = options.runtime.manager.subscribe((snapshot) => {
    if (snapshot.state_seq <= lastStateSequence) {
      invariantError ??= new Error('更新状态序号未保持严格递增')
    }
    lastStateSequence = snapshot.state_seq
    const previous = progressByGeneration.get(snapshot.operation_generation)
    if (
      snapshot.progress
      && previous
      && (
        snapshot.progress.percent < previous.percent
        || snapshot.progress.transferred < previous.transferred
      )
    ) {
      invariantError ??= new Error('同一下载代际的进度发生回退')
    }
    if (snapshot.progress) {
      progressByGeneration.set(snapshot.operation_generation, {
        percent: snapshot.progress.percent,
        transferred: snapshot.progress.transferred,
      })
    }
    snapshots.push(snapshot)
  })

  try {
    if (options.getBlockedNetworkRequests().length !== 0) {
      throw new Error('越界重定向场景前出现了非预期网络请求')
    }
    await setFeedFault(options, 'redirect_external')
    requirePhase(
      await options.runtime.manager.check('manual'),
      'error',
      '越界重定向',
    )
    const blockedRedirects = options.getBlockedNetworkRequests()
    if (
      blockedRedirects.length !== 1
      || blockedRedirects[0]
        !== 'https://example.invalid/escaped-latest.yml'
    ) {
      throw new Error('越界重定向没有被模拟网络边界拦截')
    }

    await setFeedFault(options, 'metadata_404')
    requirePhase(
      await options.runtime.manager.check('manual'),
      'error',
      '元数据 404',
    )
    requireErrorCode(
      options.runtime.getSnapshot(),
      'UPDATE_ASSET_NOT_FOUND',
    )

    await setFeedFault(options, 'normal')
    requirePhase(
      await options.runtime.manager.check('manual'),
      'available',
      '正常检查',
    )
    assertSnapshotVersion(options)
    await verifyWindowReopen(options.runtime, 'available')

    await setFeedFault(options, 'disconnect')
    requirePhase(
      await options.runtime.manager.download(),
      'error',
      '下载断流',
    )
    requireErrorCode(
      options.runtime.getSnapshot(),
      'UPDATE_DOWNLOAD_FAILED',
    )

    await setFeedFault(options, 'normal')
    requirePhase(
      await options.runtime.manager.check('manual'),
      'available',
      '断流后重试检查',
    )
    await setFeedFault(options, 'hash_mismatch')
    requirePhase(
      await options.runtime.manager.download(),
      'error',
      'SHA512 错误',
    )
    requireErrorCode(
      options.runtime.getSnapshot(),
      'UPDATE_HASH_MISMATCH',
    )

    await setFeedFault(options, 'normal')
    requirePhase(
      await options.runtime.manager.check('manual'),
      'available',
      '取消前检查',
    )
    await setFeedFault(options, 'slow')
    const progressReady = waitForDownloadProgress(options.runtime)
    const slowDownload = options.runtime.manager.download()
    await progressReady
    await verifyWindowReopen(options.runtime, 'downloading')
    requirePhase(
      await options.runtime.manager.cancelDownload(),
      'available',
      '取消下载',
    )
    await slowDownload

    await setFeedFault(options, 'normal')
    requirePhase(
      await options.runtime.manager.check('manual'),
      'available',
      '最终检查',
    )
    requirePhase(
      await options.runtime.manager.download(),
      'downloaded',
      '最终下载',
    )
    await verifyWindowReopen(options.runtime, 'downloaded')
    const asset = await verifyDownloadedAsset(options)
    if (options.getBlockedNetworkRequests().length !== 1) {
      throw new Error('模拟验收期间出现了额外的越界网络请求')
    }
    if (invariantError) {
      throw invariantError
    }

    return {
      result: 'passed',
      current_version: options.expectedBaselineVersion,
      target_version: targetVersion,
      state_events: snapshots.length,
      maximum_state_seq: lastStateSequence,
      scenarios: [
        'redirect_external',
        'metadata_404',
        'disconnect',
        'hash_mismatch',
        'cancel',
        'window_reopen',
        'download',
      ],
      downloaded_asset: asset,
    }
  } finally {
    removeListener()
    await closeUpdateWindow(options.runtime)
  }
}

export async function writeUpdateSimulationReport(
  root: string,
  report: UpdateSimulationAcceptanceReport,
) {
  const target = path.join(root, reportFileName)
  const temporary = `${target}.tmp`
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await rename(temporary, target)
}

async function verifyWindowReopen(
  runtime: ApplicationUpdateRuntime,
  expectedPhase: UpdateSnapshot['phase'],
) {
  await closeUpdateWindow(runtime)
  const first = await openAndReadUpdateWindow(runtime, new Set())
  await closeUpdateWindow(runtime)
  const second = await openAndReadUpdateWindow(runtime, new Set([first.id]))
  await closeUpdateWindow(runtime)

  assertRendererState(first.state, expectedPhase)
  assertRendererState(second.state, expectedPhase)
  if (
    first.id === second.id
    || second.state.state.state_seq < first.state.state.state_seq
    || second.state.state.operation_generation
      !== first.state.state.operation_generation
  ) {
    throw new Error(`窗口重建后更新状态未恢复: ${expectedPhase}`)
  }
}

async function openAndReadUpdateWindow(
  runtime: ApplicationUpdateRuntime,
  excludedWindowIDs: Set<number>,
) {
  const existingWindowIDs = new Set([
    ...excludedWindowIDs,
    ...BrowserWindow.getAllWindows().map((window) => window.id),
  ])
  if (!runtime.openWindow('inspect')) {
    throw new Error('无法打开模拟更新窗口')
  }
  const target = await waitForValue(
    () => BrowserWindow.getAllWindows().find((window) => (
      !window.isDestroyed() && !existingWindowIDs.has(window.id)
    )) ?? null,
    windowReadyTimeoutMs,
    '等待模拟更新窗口创建超时',
  )
  await waitForWindowLoad(target)
  const state = await target.webContents.executeJavaScript(`
    (async () => {
      if (!window.termousUpdate) {
        throw new Error('update_bridge_unavailable')
      }
      return {
        bootstrap: await window.termousUpdate.getBootstrap(),
        href: window.location.href,
        release_opened: await window.termousUpdate.openReleasePage(),
        state: await window.termousUpdate.getState(),
      }
    })()
  `, true) as RendererBridgeState
  return { id: target.id, state }
}

async function waitForWindowLoad(target: BrowserWindow) {
  if (
    target.webContents.getURL()
    && !target.webContents.isLoadingMainFrame()
  ) {
    return
  }
  await withTimeout(new Promise<void>((resolve, reject) => {
    const onLoaded = () => {
      cleanup()
      resolve()
    }
    const onFailed = (
      _event: unknown,
      errorCode: number,
      errorDescription: string,
    ) => {
      cleanup()
      reject(new Error(
        `模拟更新窗口加载失败: ${errorCode} ${errorDescription}`,
      ))
    }
    const cleanup = () => {
      target.webContents.removeListener('did-finish-load', onLoaded)
      target.webContents.removeListener('did-fail-load', onFailed)
    }
    target.webContents.once('did-finish-load', onLoaded)
    target.webContents.once('did-fail-load', onFailed)
  }), windowReadyTimeoutMs, '等待模拟更新窗口加载超时')
}

function assertRendererState(
  value: RendererBridgeState,
  expectedPhase: UpdateSnapshot['phase'],
) {
  const url = new URL(value.href)
  if (
    url.searchParams.get('surface') !== 'update'
    || value.bootstrap.intent !== 'inspect'
    || value.release_opened
    || value.bootstrap.snapshot.phase !== expectedPhase
    || value.state.phase !== expectedPhase
    || value.state.operation_generation
      !== value.bootstrap.snapshot.operation_generation
    || value.state.state_seq < value.bootstrap.snapshot.state_seq
  ) {
    throw new Error(`更新窗口 Renderer 状态错误: ${expectedPhase}`)
  }
}

async function closeUpdateWindow(runtime: ApplicationUpdateRuntime) {
  const windows = BrowserWindow.getAllWindows()
  if (windows.length === 0) {
    return
  }
  runtime.closeWindow()
  await waitForValue(
    () => BrowserWindow.getAllWindows().length === 0 ? true : null,
    windowReadyTimeoutMs,
    '等待模拟更新窗口关闭超时',
  )
}

function waitForDownloadProgress(runtime: ApplicationUpdateRuntime) {
  return withTimeout(new Promise<void>((resolve) => {
    const remove = runtime.manager.subscribe((snapshot) => {
      if (
        snapshot.phase === 'downloading'
        && (snapshot.progress?.transferred ?? 0) > 0
      ) {
        remove()
        resolve()
      }
    })
  }), 30_000, '等待下载进度超时')
}

async function setFeedFault(options: AcceptanceOptions, faultMode: string) {
  const endpoint = new URL('/__control', options.expectedFeedURL)
  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
    headers: {
      'Content-Type': 'application/json',
      'X-Termous-Simulation-Token': options.context.controlToken,
    },
    body: JSON.stringify({ fault_mode: faultMode }),
  })
  const body = await response.json().catch(() => null) as {
    fault_mode?: unknown
  } | null
  if (
    !response.ok
    || response.url !== endpoint.href
    || body?.fault_mode !== faultMode
  ) {
    throw new Error(`无法切换更新源故障模式: ${faultMode}`)
  }
}

async function verifyDownloadedAsset(
  options: AcceptanceOptions,
): Promise<ValidatedSimulationAsset> {
  if (options.downloadedFiles.length !== 1) {
    throw new Error(`下载文件数量不正确: ${options.downloadedFiles.length}`)
  }
  const downloadedPath = await realpath(options.downloadedFiles[0])
  const relative = path.relative(options.context.root, downloadedPath)
  if (
    !relative
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error('下载文件不在隔离的模拟目录内')
  }
  const digest = await hashFile(downloadedPath)
  const info = await stat(downloadedPath)
  if (
    digest !== options.validatedAsset.sha512
    || info.size !== options.validatedAsset.size
  ) {
    throw new Error('下载后的安装器 SHA512 或大小与预验证资产不一致')
  }
  return {
    ...options.validatedAsset,
    size: info.size,
    sha512: digest,
  }
}

function assertSnapshotVersion(options: AcceptanceOptions) {
  const snapshot = options.runtime.getSnapshot()
  if (
    snapshot.current_version !== options.expectedBaselineVersion
    || snapshot.available_version !== targetVersion
  ) {
    throw new Error('模拟更新版本不是预期的 0.0.1 → 0.0.2')
  }
}

function requirePhase(
  snapshot: UpdateSnapshot,
  expected: UpdateSnapshot['phase'],
  scenario: string,
) {
  if (snapshot.phase !== expected) {
    throw new Error(`${scenario} 状态错误: ${snapshot.phase}`)
  }
}

function requireErrorCode(
  snapshot: UpdateSnapshot,
  expected: NonNullable<UpdateSnapshot['error_code']>,
) {
  if (snapshot.error_code !== expected) {
    throw new Error(`更新错误码错误: ${snapshot.error_code ?? 'none'}`)
  }
}

async function hashFile(filePath: string) {
  const digest = createHash('sha512')
  for await (const chunk of createReadStream(filePath)) {
    digest.update(chunk)
  }
  return digest.digest('base64')
}

async function waitForValue<T>(
  read: () => T | null,
  timeoutMs: number,
  message: string,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (value !== null) {
      return value
    }
    await delay(25)
  }
  throw new Error(message)
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

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}
