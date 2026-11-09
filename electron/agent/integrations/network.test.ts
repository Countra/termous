import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { connect } from 'node:net'
import { integrationNetwork, applyIntegrationProxy } from './network.ts'
import { integrationEnvironment } from './environment.ts'
import { redactIntegrationDetail } from './diagnostics.ts'

test('软件代理覆盖来源配置，关闭后恢复原值且不继承宿主代理', () => {
  const source = { http_proxy: 'http://source.invalid', HTTPS_PROXY: 'http://source.invalid', PATH: 'fixture', API_KEY: 'fixture-secret' }
  const settings = { enabled: true, url: 'http://127.0.0.1:7890', bypass: ['example.test:8080'] }
  const posix = applyIntegrationProxy(source, settings, 'linux')
  assert.equal(posix.http_proxy, settings.url)
  assert.equal(posix.HTTPS_PROXY, settings.url)
  assert.equal(posix.NPM_CONFIG_PROXY, settings.url)
  assert.equal(posix.API_KEY, source.API_KEY)
  assert.match(posix.NO_PROXY, /\.example.test:8080/u)
  const windows = applyIntegrationProxy(source, settings, 'win32')
  assert.equal(windows.http_proxy, undefined)
  assert.equal(windows.HTTP_PROXY, settings.url)
  assert.deepEqual(applyIntegrationProxy(source, { ...settings, enabled: false }), source)
  assert.equal(integrationEnvironment({ HTTP_PROXY: 'http://uncontrolled.invalid' }).HTTP_PROXY, undefined)
  assert.equal(source.http_proxy, 'http://source.invalid')
})

test('独立代理 dispatcher 转发外部请求，回环请求始终直连', async () => {
  const target = createServer((_request, response) => response.end('fixture'))
  target.listen(0, '127.0.0.1'); await once(target, 'listening')
  const address = target.address(); assert.ok(address && typeof address !== 'string')
  let tunnels = 0
  const proxy = createServer()
  const sockets = new Set<{ destroy(): void }>()
  proxy.on('connect', (_request, socket, head) => {
    tunnels++
    sockets.add(socket)
    const upstream = connect(address.port, '127.0.0.1')
    sockets.add(upstream)
    upstream.on('close', () => { sockets.delete(upstream); socket.destroy() })
    upstream.on('connect', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket) })
    upstream.on('error', () => socket.destroy())
    socket.on('close', () => { sockets.delete(socket); upstream.destroy() })
  })
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
  const proxyAddress = proxy.address(); assert.ok(proxyAddress && typeof proxyAddress !== 'string')
  const network = integrationNetwork({ enabled: true, url: `http://127.0.0.1:${proxyAddress.port}`, bypass: [] })
  try {
    assert.equal(await (await network.fetch('http://registry.fixture/package', { signal: AbortSignal.timeout(3000) })).text(), 'fixture')
    assert.equal(await (await network.fetch(`http://127.0.0.1:${address.port}`, { signal: AbortSignal.timeout(3000) })).text(), 'fixture')
    assert.equal(tunnels, 1)
  } finally {
    for (const socket of sockets) socket.destroy()
    await network.close()
    proxy.closeAllConnections(); target.closeAllConnections()
    await Promise.all([new Promise<void>(resolve => proxy.close(() => resolve())), new Promise<void>(resolve => target.close(() => resolve()))])
  }
})

test('第三方诊断限长并删除已知环境值和认证字段', () => {
  const text = redactIntegrationDetail('stderr fixture-secret\nAuthorization: Bearer abc\nhttps://user:pass@host.test\n' + 'x'.repeat(9000), { environment: { API_KEY: 'fixture-secret' } })
  assert.ok(text.length <= 8192)
  assert.ok(!text.includes('fixture-secret') && !text.includes('user:pass'))
})
