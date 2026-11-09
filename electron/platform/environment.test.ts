import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import type { App } from 'electron'

for (const channel of ['production', 'development'] as const) {
  test(`${channel} 在单实例锁之前分配正确目录，正式偏好和日志不搬迁`, async t => {
    const root = path.resolve('../TEMP/desktop-environment-tests')
    await mkdir(root, { recursive: true })
    const directory = await mkdtemp(path.join(root, 'fixture-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ termousDesktopChannel: channel }))
    const original = path.join(directory, 'legacy-user-data')
    const paths = new Map([['appData', directory], ['userData', original], ['logs', path.join(directory, 'old-logs')]])
    const state = { name: '', appId: '', clsid: '' }
    const app = {
      getAppPath: () => directory, getPath: (name: string) => paths.get(name),
      setPath: (name: string, value: string) => paths.set(name, value),
      setAppLogsPath: (value: string) => paths.set('logs', value),
      setName: (name: string) => { state.name = name },
      setAppUserModelId: (appId: string) => { state.appId = appId },
      setToastActivatorCLSID: (clsid: string) => { state.clsid = clsid },
      setDesktopName() {},
    }
    const globals = globalThis as unknown as { __TERMOUS_DESKTOP_CHANNEL__?: string }
    globals.__TERMOUS_DESKTOP_CHANNEL__ = channel
    const module = await import(`./environment.ts?${channel}`) as typeof import('./environment.ts')
    delete globals.__TERMOUS_DESKTOP_CHANNEL__
    module.initializeDesktopEnvironment(app as unknown as App)
    assert.equal(paths.get('userData'), channel === 'production' ? original : path.join(directory, 'Termous Dev'))
    assert.equal(paths.get('sessionData'), paths.get('userData'))
    assert.equal(paths.get('logs'), channel === 'production' ? path.join(directory, 'old-logs') : path.join(directory, 'Termous Dev/logs'))
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ termousDesktopChannel: 'wrong' }))
    assert.throws(() => module.initializeDesktopEnvironment(app as unknown as App), /渠道不一致/)
  })
}
