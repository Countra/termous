import assert from 'node:assert/strict'
import { mkdir, mkdtemp, copyFile, rm, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

for (const running of [true, false]) {
  test(`无参数开发壳在${running ? '已有实例时只激活' : '开发停止时提示启动命令'}`, async t => {
    const root = fileURLToPath(new URL('../../../TEMP/desktop-bootstrap-tests/', import.meta.url))
    await mkdir(root, { recursive: true })
    const directory = await mkdtemp(path.join(root, 'shell-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    await copyFile(new URL('./bootstrap.mjs', import.meta.url), path.join(directory, 'bootstrap.mjs'))
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ termousDesktopChannel: 'development', productName: 'Termous Dev' }))
    const events = []
    const paths = new Map()
    globalThis.termousBootstrapFixture = {
      app: { getPath: () => directory, setName() {}, setPath: (key, value) => paths.set(key, value),
        requestSingleInstanceLock: () => !running, exit: code => events.push(code), quit: () => events.push('quit'), whenReady: () => Promise.resolve() },
      dialog: { showMessageBox: async options => { events.push(options.detail) } },
    }
    const entry = pathToFileURL(path.join(directory, 'bootstrap.mjs')).href
    const hooks = registerHooks({ resolve(specifier, context, next) {
      if (specifier === 'electron' && context.parentURL === entry) return { url: `data:text/javascript,export const {app,dialog}=globalThis.termousBootstrapFixture#${running}`, shortCircuit: true }
      return next(specifier, context)
    } })
    try { await import(entry); await new Promise(resolve => setImmediate(resolve)) }
    finally { hooks.deregister(); delete globalThis.termousBootstrapFixture }
    assert.equal(paths.get('userData'), path.join(directory, 'Termous Dev'))
    assert.deepEqual(events, running ? [0] : ['请在 web 目录运行 pnpm dev。', 'quit'])
  })
}

test('开发壳从 Vite 加载主入口，父进程断开后退出所属壳', async t => {
  const root = fileURLToPath(new URL('../../../TEMP/desktop-bootstrap-tests/', import.meta.url))
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(path.join(root, 'connected-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await copyFile(new URL('./bootstrap.mjs', import.meta.url), path.join(directory, 'bootstrap.mjs'))
  const entry = pathToFileURL(path.join(directory, 'bootstrap.mjs')).href
  const main = path.join(directory, 'main.mjs')
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ termousDesktopChannel: 'development', termousDevelopmentEntry: main }))
  const imported = Promise.withResolvers()
  const events = []
  globalThis.termousConnectedBootstrapFixture = {
    app: { exit: code => events.push(code) }, dialog: {}, ready: imported.resolve,
  }
  await writeFile(main, 'globalThis.termousConnectedBootstrapFixture.ready()')
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === 'electron' && context.parentURL === entry) return { url: 'data:text/javascript,export const {app,dialog}=globalThis.termousConnectedBootstrapFixture', shortCircuit: true }
    return next(specifier, context)
  } })
  const argv = process.argv
  const send = process.send
  const url = process.env.VITE_DEV_SERVER_URL
  const listeners = process.listeners('disconnect')
  try {
    process.argv = [...argv, '--termous-development-start']
    process.send = () => true
    process.env.VITE_DEV_SERVER_URL = 'http://127.0.0.1:5173'
    await import(entry)
    await imported.promise
    assert.deepEqual(events, [])
    process.emit('disconnect')
    assert.deepEqual(events, [0])
  } finally {
    process.argv = argv
    if (send) process.send = send
    else delete process.send
    if (url === undefined) delete process.env.VITE_DEV_SERVER_URL
    else process.env.VITE_DEV_SERVER_URL = url
    for (const listener of process.listeners('disconnect')) if (!listeners.includes(listener)) process.removeListener('disconnect', listener)
    hooks.deregister()
    delete globalThis.termousConnectedBootstrapFixture
  }
})
