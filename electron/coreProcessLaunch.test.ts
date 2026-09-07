import assert from 'node:assert/strict'
import type {
  ChildProcessWithoutNullStreams,
  SpawnOptionsWithoutStdio,
} from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  buildManagedCoreArguments,
  runManagedCorePortAttempts,
  spawnManagedCoreProcess,
  type ManagedCoreSpawn,
} from './coreProcessLaunch.ts'

const coreProcessSource = readFileSync(new URL('./coreProcess.ts', import.meta.url), 'utf8')

test('正式安装包为托管 Core 传入日志目录', () => {
  assert.deepEqual(
    buildManagedCoreArguments({
      addr: '127.0.0.1:8152',
      packaged: true,
      logDirectory: 'C:\\Users\\CountRa\\AppData\\Roaming\\Termous\\logs',
    }),
    [
      '--addr',
      '127.0.0.1:8152',
      '--log-dir',
      'C:\\Users\\CountRa\\AppData\\Roaming\\Termous\\logs',
    ],
  )
})

test('开发环境不向托管 Core 传入日志目录', () => {
  assert.deepEqual(
    buildManagedCoreArguments({
      addr: '127.0.0.1:8122',
      packaged: false,
      logDirectory: 'C:\\ignored\\logs',
    }),
    ['--addr', '127.0.0.1:8122'],
  )
})

test('包含空格的日志目录保持为单个参数', () => {
  const args = buildManagedCoreArguments({
    addr: '127.0.0.1:8152',
    packaged: true,
    logDirectory: 'C:\\Users\\Example User\\App Data\\Termous\\logs',
  })

  assert.equal(args.length, 4)
  assert.equal(args[3], 'C:\\Users\\Example User\\App Data\\Termous\\logs')
})

test('托管 Core 启动使用构造参数并持续消费标准输出和错误输出', () => {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const child = { stdout, stderr } as unknown as ChildProcessWithoutNullStreams
  const launches: Array<{
    command: string
    args: readonly string[]
    options: SpawnOptionsWithoutStdio
  }> = []
  const spawnProcess: ManagedCoreSpawn = (command, args, options) => {
    launches.push({ command, args, options })
    return child
  }
  const binaryPath = path.join('build', 'core', process.platform === 'win32' ? 'termous-core.exe' : 'termous-core')

  const launched = spawnManagedCoreProcess({
    binaryPath,
    addr: '127.0.0.1:8152',
    token: 'test-token',
    packaged: true,
    logDirectory: path.join('Termous', 'logs'),
    environment: { ...process.env, TEST_BASE_ENV: 'kept' },
    parentPid: 4242,
  }, spawnProcess)

  assert.equal(launched, child)
  assert.equal(launches.length, 1)
  const launch = launches[0]
  assert.equal(launch.command, binaryPath)
  assert.deepEqual(launch.args, [
    '--addr',
    '127.0.0.1:8152',
    '--log-dir',
    path.join('Termous', 'logs'),
  ])
  assert.equal(launch.options.cwd, path.dirname(binaryPath))
  assert.equal(launch.options.windowsHide, true)
  assert.equal(launch.options.stdio, 'pipe')
  assert.equal(launch.options.env?.TEST_BASE_ENV, 'kept')
  assert.equal(launch.options.env?.TERMOUS_ADDR, '127.0.0.1:8152')
  assert.equal(launch.options.env?.TERMOUS_API_TOKEN, 'test-token')
  assert.equal(launch.options.env?.TERMOUS_PARENT_PID, '4242')
  assert.equal(stdout.listenerCount('data'), 1)
  assert.equal(stderr.listenerCount('data'), 1)
})

test('CoreProcessManager 的真实启动路径复用受测的托管启动合同', () => {
  const startManagedCoreSource = coreProcessSource.slice(
    coreProcessSource.indexOf('  private async startManagedCore('),
    coreProcessSource.indexOf('  private async waitUntilReady('),
  )

  assert.match(startManagedCoreSource, /spawnManagedCoreProcess\(\{/)
  assert.doesNotMatch(startManagedCoreSource, /\bspawn\(/)
})

test('启动期退出也使用受控子进程终止链路', () => {
  const shutdownSource = coreProcessSource.slice(
    coreProcessSource.indexOf('  private async shutdownOnce('),
    coreProcessSource.indexOf('  restartAfterRestore()'),
  )

  assert.match(shutdownSource, /if \(!this\.config\.managed\)[\s\S]*await this\.stopChildOnly\(\)/)
  assert.doesNotMatch(shutdownSource, /child\.kill\(/)
})

test('数据恢复后的并发重启复用同一个受控流程', () => {
  const restartSource = coreProcessSource.slice(
    coreProcessSource.indexOf('  restartAfterRestore()'),
    coreProcessSource.indexOf('  async recoverAfterFailedUpdateInstall('),
  )

  assert.match(restartSource, /restoreRestartSingleflight\.run\(\(\) => this\.restartAfterRestoreOnce\(\)\)/)
  assert.equal((restartSource.match(/private async restartAfterRestoreOnce\(/g) ?? []).length, 1)
})

test('失败进程清理失败时终止端口重试且不会二次 spawn', async () => {
  const attemptedPorts: number[] = []
  const cleanupError = new Error('旧进程仍在运行')

  await assert.rejects(runManagedCorePortAttempts({
    portStart: 8152,
    maxPortSwitches: 3,
    isStopping: () => false,
    start: async (port) => {
      attemptedPorts.push(port)
      throw new Error('启动失败')
    },
    stopFailedAttempt: async () => {
      throw cleanupError
    },
  }), cleanupError)

  assert.deepEqual(attemptedPorts, [8152])
})

test('失败进程确认退出后才继续尝试下一个端口', async () => {
  const attemptedPorts: number[] = []
  let cleanupCalls = 0

  const result = await runManagedCorePortAttempts({
    portStart: 8152,
    maxPortSwitches: 3,
    isStopping: () => false,
    start: async (port) => {
      attemptedPorts.push(port)
      if (port === 8152) {
        throw new Error('端口不可用')
      }
    },
    stopFailedAttempt: async () => {
      cleanupCalls += 1
    },
  })

  assert.deepEqual(result, { status: 'started', port: 8153 })
  assert.deepEqual(attemptedPorts, [8152, 8153])
  assert.equal(cleanupCalls, 1)
})
