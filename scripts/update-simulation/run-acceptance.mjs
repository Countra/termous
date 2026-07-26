import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  assertSafeSimulationOutputRoot,
  sanitizeSimulationEnvironment,
  validateUpdateSimulationFixtures,
} from './build-fixtures.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultWebDirectory = path.resolve(scriptDirectory, '..', '..')
const defaultTimeoutMs = 150_000
const feedReadyTimeoutMs = 15_000
const processStopGraceMs = 3_000
const processTerminationHelperTimeoutMs = 5_000
const processTerminationHelperStopGraceMs = 500
const runtimeDirectoryPrefix = 'termous-update-acceptance-'
const reportFileName = 'acceptance-report.json'
const requiredScenarios = Object.freeze([
  'redirect_external',
  'metadata_404',
  'disconnect',
  'hash_mismatch',
  'cancel',
  'window_reopen',
  'download',
])

export class UpdateSimulationRunnerError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'UpdateSimulationRunnerError'
    this.code = code
    Object.assign(this, details)
  }
}

export async function runLocalUpdateSimulationAcceptance(
  options = {},
  dependencies = {},
) {
  const webDirectory = path.resolve(
    options.webDirectory ?? defaultWebDirectory,
  )
  const timeoutMs = normalizeTimeout(options.timeoutMs)
  const signalTarget = dependencies.signalTarget ?? process
  const resolveFixture = dependencies.resolveFixture
    ?? resolveUpdateSimulationFixture
  const createRuntimeRoot = dependencies.createRuntimeRoot
    ?? createOwnedRuntimeRoot
  const removeRuntimeRoot = dependencies.removeRuntimeRoot
    ?? removeOwnedRuntimeRoot
  const launchFeed = dependencies.launchFeed ?? launchFeedProcess
  const launchElectron = dependencies.launchElectron
    ?? launchElectronProcess
  const readReport = dependencies.readReport ?? readAcceptanceReport
  const lifecycle = new AbortController()
  const managedProcesses = []
  let runtimeRoot = null
  let result
  let failure = null

  const interrupt = (signalName) => {
    abortLifecycle(
      lifecycle,
      new UpdateSimulationRunnerError(
        'interrupted',
        `本地更新模拟被 ${signalName} 中断`,
        { signal: signalName },
      ),
    )
  }
  const onSIGINT = () => interrupt('SIGINT')
  const onSIGTERM = () => interrupt('SIGTERM')
  signalTarget.once('SIGINT', onSIGINT)
  signalTarget.once('SIGTERM', onSIGTERM)
  const timer = setTimeout(() => {
    abortLifecycle(
      lifecycle,
      new UpdateSimulationRunnerError(
        'timeout',
        `本地更新模拟超过 ${timeoutMs}ms 总预算`,
      ),
    )
  }, timeoutMs)

  try {
    const fixture = await resolveFixture(webDirectory)
    throwIfAborted(lifecycle.signal)
    runtimeRoot = await createRuntimeRoot()
    throwIfAborted(lifecycle.signal)
    const controlToken = randomBytes(32).toString('base64url')
    const environment = {
      ...sanitizeSimulationEnvironment(
        dependencies.environment ?? process.env,
      ),
      TERMOUS_UPDATE_SIMULATION_ROOT: runtimeRoot,
      TERMOUS_UPDATE_SIMULATION_FEED_ROOT: fixture.feedRoot,
      TERMOUS_UPDATE_SIMULATION_TOKEN: controlToken,
    }

    const feed = launchFeed({
      controlToken,
      environment,
      feedRoot: fixture.feedRoot,
      webDirectory,
    })
    managedProcesses.push(feed)
    throwIfAborted(lifecycle.signal)
    await waitWithAbort(
      withTimeout(
        feed.ready,
        feedReadyTimeoutMs,
        '等待本地更新源启动超时',
      ),
      lifecycle.signal,
    )

    const electron = launchElectron({
      environment,
      executable: fixture.baselineExecutable,
      webDirectory,
    })
    managedProcesses.push(electron)
    throwIfAborted(lifecycle.signal)
    const exit = await waitWithAbort(
      electron.completed,
      lifecycle.signal,
    )
    if (exit.code !== 0) {
      throw new UpdateSimulationRunnerError(
        'electron_failed',
        exit.signal
          ? `更新模拟程序被 ${exit.signal} 终止`
          : `更新模拟程序退出码异常: ${exit.code ?? 'unknown'}`,
      )
    }

    const report = await readReport(runtimeRoot)
    validateAcceptanceReport(report, fixture)
    result = report
  } catch (error) {
    failure = error
  } finally {
    abortLifecycle(
      lifecycle,
      new UpdateSimulationRunnerError(
        'cleanup',
        '本地更新模拟进入资源清理阶段',
      ),
    )
    clearTimeout(timer)
    signalTarget.removeListener('SIGINT', onSIGINT)
    signalTarget.removeListener('SIGTERM', onSIGTERM)

    const cleanupErrors = []
    for (const managedProcess of managedProcesses.reverse()) {
      try {
        await managedProcess.stop()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (runtimeRoot) {
      try {
        await removeRuntimeRoot(runtimeRoot)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (cleanupErrors.length > 0) {
      const cleanupFailure = new AggregateError(
        cleanupErrors,
        '本地更新模拟资源未能完整清理',
      )
      failure = failure
        ? new AggregateError(
            [failure, cleanupFailure],
            '本地更新模拟失败，且资源清理不完整',
          )
        : cleanupFailure
    }
  }

  if (failure) {
    throw failure
  }
  return result
}

async function resolveUpdateSimulationFixture(webDirectory) {
  const fixtureRoot = path.join(
    webDirectory,
    'release',
    'update-simulation',
  )
  await assertSafeSimulationOutputRoot(fixtureRoot, webDirectory)
  const baselineDirectory = path.join(fixtureRoot, 'baseline')
  const candidateDirectory = path.join(fixtureRoot, 'candidate')
  const fixture = await validateUpdateSimulationFixtures({
    baselineDirectory,
    candidateDirectory,
  })
  const installerInfo = await stat(fixture.installer)
  return {
    baselineExecutable: fixture.baselineExecutable,
    currentVersion: '0.0.1',
    downloadedAsset: {
      name: path.basename(fixture.installer),
      sha512: await hashFile(fixture.installer),
      size: installerInfo.size,
    },
    feedRoot: candidateDirectory,
    targetVersion: '0.0.2',
  }
}

function launchFeedProcess(options) {
  const child = spawn(
    process.execPath,
    [path.join(scriptDirectory, 'feed-server.mjs')],
    createSpawnOptions(options.webDirectory, options.environment),
  )
  const managed = createManagedProcess(child, 'feed')
  return {
    ...managed,
    ready: waitForFeedReady(child, managed.completed),
  }
}

function launchElectronProcess(options) {
  const child = spawn(
    options.executable,
    [],
    createSpawnOptions(options.webDirectory, options.environment),
  )
  const managed = createManagedProcess(child, 'electron')
  forwardOutput(child.stdout, 'electron', process.stdout)
  forwardOutput(child.stderr, 'electron', process.stderr)
  return {
    ...managed,
    ready: Promise.resolve(),
  }
}

function createSpawnOptions(cwd, env) {
  return {
    cwd,
    detached: process.platform !== 'win32',
    env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }
}

function createManagedProcess(child, label) {
  let settled = false
  const completed = new Promise((resolve, reject) => {
    child.once('error', (error) => {
      settled = true
      reject(new Error(`无法启动${processLabel(label)}: ${error.message}`, {
        cause: error,
      }))
    })
    child.once('exit', (code, signal) => {
      settled = true
      resolve({ code, signal })
    })
  })
  return {
    completed,
    async stop() {
      if (settled) {
        return
      }
      if (process.platform === 'win32') {
        // Windows 必须在父进程仍存活时按 PID 清理整棵进程树，避免 Renderer 成为孤儿进程。
        await forceProcessTreeTermination(child)
        await Promise.race([
          completed.catch(() => undefined),
          delay(processStopGraceMs),
        ])
        if (!settled) {
          throw new Error(`${processLabel(label)}在进程树清理后仍未退出`)
        }
        return
      }
      requestProcessTreeTermination(child, 'SIGTERM')
      await Promise.race([
        completed.catch(() => undefined),
        delay(processStopGraceMs),
      ])
      if (settled) {
        return
      }
      await forceProcessTreeTermination(child)
      await Promise.race([
        completed.catch(() => undefined),
        delay(processStopGraceMs),
      ])
      if (!settled) {
        throw new Error(`${processLabel(label)}在强制终止后仍未退出`)
      }
    },
  }
}

function waitForFeedReady(child, completed) {
  return new Promise((resolve, reject) => {
    let buffer = ''
    let ready = false
    const cleanup = () => {
      child.stdout?.removeListener('data', onData)
    }
    const onData = (chunk) => {
      buffer += chunk.toString('utf8')
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (line) {
          process.stdout.write(`[update-simulation:feed] ${line}\n`)
          const event = parseJSON(line)
          if (
            event?.event === 'update_simulation_feed_ready'
            && event.address?.address === '127.0.0.1'
            && event.address?.port === 18991
          ) {
            ready = true
            cleanup()
            resolve()
            return
          }
        }
        newlineIndex = buffer.indexOf('\n')
      }
    }
    child.stdout?.on('data', onData)
    forwardOutput(child.stderr, 'feed', process.stderr)
    completed.then((exit) => {
      if (!ready) {
        cleanup()
        reject(new Error(
          exit.signal
            ? `本地更新源在就绪前被 ${exit.signal} 终止`
            : `本地更新源在就绪前退出: ${exit.code ?? 'unknown'}`,
        ))
      }
    }, (error) => {
      if (!ready) {
        cleanup()
        reject(error)
      }
    })
  })
}

function forwardOutput(stream, label, destination) {
  if (!stream) {
    return
  }
  let buffer = ''
  stream.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)
      destination.write(`[update-simulation:${label}] ${line}\n`)
      newlineIndex = buffer.indexOf('\n')
    }
  })
  stream.once('end', () => {
    if (buffer) {
      destination.write(`[update-simulation:${label}] ${buffer}\n`)
    }
  })
}

function requestProcessTreeTermination(child, signal) {
  if (!child.pid || hasChildProcessExited(child)) {
    return
  }
  try {
    if (process.platform === 'win32') {
      child.kill(signal)
    } else {
      process.kill(-child.pid, signal)
    }
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      throw error
    }
  }
}

async function forceProcessTreeTermination(child) {
  if (!child.pid || hasChildProcessExited(child)) {
    return
  }
  if (process.platform !== 'win32') {
    requestProcessTreeTermination(child, 'SIGKILL')
    return
  }
  const taskkill = spawn(
    'taskkill.exe',
    ['/PID', String(child.pid), '/T', '/F'],
    {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    },
  )
  const result = await waitForChildExitWithTimeout(
    taskkill,
    processTerminationHelperTimeoutMs,
  )
  if (!result) {
    // 超时后的辅助进程仍可能异步上报 error，必须保留兜底监听直到对象被回收。
    taskkill.once('error', () => undefined)
    try {
      taskkill.kill()
    } catch {
      // 辅助进程可能刚好在超时边界退出，后续仍返回明确的清理失败。
    }
    await waitForChildExitWithTimeout(
      taskkill,
      processTerminationHelperStopGraceMs,
    ).catch(() => null)
    throw new Error(`终止模拟进程树超时: ${child.pid}`)
  }
  if (result.code !== 0 && !hasChildProcessExited(child)) {
    throw new Error(`无法终止模拟进程树: ${child.pid}`)
  }
}

export function hasChildProcessExited(child) {
  return child.exitCode !== null || child.signalCode !== null
}

export function waitForChildExitWithTimeout(child, timeoutMs) {
  if (hasChildProcessExited(child)) {
    return Promise.resolve({
      code: child.exitCode,
      signal: child.signalCode,
    })
  }
  return new Promise((resolve, reject) => {
    let settled = false
    let timer
    const cleanup = () => {
      child.removeListener('error', onError)
      child.removeListener('exit', onExit)
      if (timer) {
        clearTimeout(timer)
      }
    }
    const finish = (result) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(result)
    }
    const onError = (error) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    }
    const onExit = (code, signal) => {
      finish({ code, signal })
    }
    child.once('error', onError)
    child.once('exit', onExit)
    timer = setTimeout(() => finish(null), timeoutMs)
    if (hasChildProcessExited(child)) {
      finish({
        code: child.exitCode,
        signal: child.signalCode,
      })
    }
  })
}

async function createOwnedRuntimeRoot() {
  return mkdtemp(path.join(os.tmpdir(), runtimeDirectoryPrefix))
}

async function removeOwnedRuntimeRoot(rootValue) {
  const root = path.resolve(rootValue)
  const info = await lstat(root)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('拒绝清理非普通目录的模拟运行环境')
  }
  const [actualRoot, actualTemporaryDirectory] = await Promise.all([
    realpath(root),
    realpath(os.tmpdir()),
  ])
  const relative = path.relative(actualTemporaryDirectory, actualRoot)
  if (
    !path.basename(actualRoot).startsWith(runtimeDirectoryPrefix)
    || !relative
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error('拒绝清理无法归属的模拟运行环境')
  }
  await rm(root, {
    force: true,
    maxRetries: 3,
    recursive: true,
    retryDelay: 150,
  })
}

async function readAcceptanceReport(root) {
  const content = await readFile(path.join(root, reportFileName), 'utf8')
  try {
    return JSON.parse(content)
  } catch (error) {
    throw new Error('本地更新模拟报告不是有效 JSON', { cause: error })
  }
}

function validateAcceptanceReport(report, fixture) {
  const downloadedAsset = report?.downloaded_asset
  if (
    !report
    || report.result !== 'passed'
    || report.current_version !== fixture.currentVersion
    || report.target_version !== fixture.targetVersion
    || !Number.isSafeInteger(report.state_events)
    || report.state_events <= 0
    || !Number.isSafeInteger(report.maximum_state_seq)
    || report.maximum_state_seq <= 0
    || !Array.isArray(report.scenarios)
    || report.scenarios.length !== requiredScenarios.length
    || report.scenarios.some(
      (scenario, index) => scenario !== requiredScenarios[index],
    )
    || !downloadedAsset
    || downloadedAsset.name !== fixture.downloadedAsset.name
    || downloadedAsset.size !== fixture.downloadedAsset.size
    || downloadedAsset.sha512 !== fixture.downloadedAsset.sha512
  ) {
    throw new Error('本地更新模拟报告未通过契约校验')
  }
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')))
  })
}

function waitWithAbort(promise, signal) {
  if (signal.aborted) {
    return Promise.reject(signal.reason)
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then((value) => {
      signal.removeEventListener('abort', onAbort)
      resolve(value)
    }, (error) => {
      signal.removeEventListener('abort', onAbort)
      reject(error)
    })
  })
}

function withTimeout(promise, timeoutMs, message) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  })
}

function throwIfAborted(signal) {
  if (signal.aborted) {
    throw signal.reason
  }
}

function abortLifecycle(controller, reason) {
  if (!controller.signal.aborted) {
    controller.abort(reason)
  }
}

function normalizeTimeout(value) {
  if (value === undefined) {
    return defaultTimeoutMs
  }
  if (!Number.isSafeInteger(value) || value < 1 || value > 600_000) {
    throw new Error('本地更新模拟超时必须在 1ms 到 600000ms 之间')
  }
  return value
}

function parseJSON(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function processLabel(label) {
  return label === 'feed' ? '本地更新源进程' : '更新模拟程序'
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

async function main() {
  const report = await runLocalUpdateSimulationAcceptance()
  console.log('本地更新模拟验收通过:')
  console.log(JSON.stringify(report, null, 2))
}

const entryPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null
if (entryPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = error?.signal === 'SIGINT'
      ? 130
      : error?.signal === 'SIGTERM'
        ? 143
        : 1
  })
}
