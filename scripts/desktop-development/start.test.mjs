import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import electron from 'vite-plugin-electron'
import { createDevelopmentStarter } from './start.mjs'

function fixture(prepare = async () => 'fixture-launcher.cjs') {
  const events = []
  let child
  const runtime = createDevelopmentStarter({
    prepare, child: () => child, cwd: 'fixture', report: error => events.push(error.message),
    stop: async current => { if (current) { events.push('stop'); current.exitCode = 0 } },
  })
  const context = {
    async startup(args, options, launcher) {
      assert.deepEqual(args, ['--termous-development-start'])
      assert.equal(options.cwd, 'fixture')
      assert.equal(launcher, 'fixture-launcher.cjs')
      events.push('start')
      child = { exitCode: null, signalCode: null }
    },
    reload: () => events.push('reload'),
  }
  return { runtime, context, events }
}

test('首次只有 preload 回调时仍启动开发壳，后续 preload 只重载页面', async () => {
  const f = fixture()
  await Promise.all([f.runtime.run(f.context), f.runtime.run(f.context)])
  assert.deepEqual(f.events, ['start', 'reload'])
  await f.runtime.run(f.context, true)
  assert.deepEqual(f.events, ['start', 'reload', 'stop', 'start'])
  await f.runtime.close()
})

test('准备失败被报告，下一次构建可以重新启动', async () => {
  let first = true
  const f = fixture(async () => {
    if (first) { first = false; throw new Error('fixture failure') }
    return 'fixture-launcher.cjs'
  })
  await f.runtime.run(f.context)
  await f.runtime.run(f.context)
  assert.deepEqual(f.events, ['fixture failure', 'start'])
  await f.runtime.close()
})

test('准备尚未完成时关闭 Vite，迟到的构建和重载不能再启动应用', async () => {
  const prepared = Promise.withResolvers()
  const f = fixture(() => prepared.promise)
  const pending = f.runtime.run(f.context)
  await Promise.resolve()
  const closing = f.runtime.close()
  prepared.resolve('fixture-launcher.cjs')
  await Promise.all([pending, closing])
  await f.runtime.run(f.context, true)
  assert.deepEqual(f.events, [])
})

test('真实 Vite 多入口首次构建经 preload 回调启动专属壳', { timeout: 20000 }, async t => {
  const root = fileURLToPath(new URL('../../../TEMP/desktop-start-tests/', import.meta.url))
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(path.join(root, 'vite-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, 'package.json'), '{"type":"module"}')
  for (const name of ['main', 'preload']) await writeFile(path.join(directory, `${name}.js`), 'export const fixture = true')
  const started = Promise.withResolvers()
  const f = fixture()
  const callbacks = []
  const server = await createServer({
    configFile: false, root: directory, logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
    plugins: [electron(['main', 'preload'].map(name => ({
      entry: path.join(directory, `${name}.js`),
      vite: { logLevel: 'silent', build: { watch: null } },
      onstart() {
        callbacks.push(name)
        return f.runtime.run({ ...f.context, startup: async (...args) => {
          await f.context.startup(...args)
          started.resolve()
        } }, name === 'main')
      },
    })))],
  })
  t.after(() => server.close())
  t.after(() => f.runtime.close())
  await server.listen()
  await started.promise
  assert.deepEqual(callbacks, ['preload'])
  assert.deepEqual(f.events, ['start'])
})
