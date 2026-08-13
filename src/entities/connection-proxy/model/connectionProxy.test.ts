import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConnectionProxy } from './types.ts'
import {
  normalizeConnectionProxyInput,
  validateConnectionProxyInput,
  validateConnectionProxyUrl,
} from './connectionProxy.ts'

test('连接代理仅接受类型匹配且包含显式端口的 URL', () => {
  assert.equal(validateConnectionProxyUrl('http_connect', 'http://proxy.example:8080'), undefined)
  assert.equal(validateConnectionProxyUrl('socks5', 'socks5://[::1]:1080'), undefined)
  assert.equal(validateConnectionProxyUrl('http_connect', 'http://proxy.example:80'), undefined)
})

test('连接代理拒绝认证信息、额外路径和非规范协议', () => {
  assert.equal(
    validateConnectionProxyUrl('http_connect', 'http://user:secret@proxy.example:8080'),
    'authenticationUnsupported',
  )
  assert.equal(
    validateConnectionProxyUrl('http_connect', 'http://proxy.example:8080/tunnel'),
    'urlInvalid',
  )
  assert.equal(
    validateConnectionProxyUrl('http_connect', 'http://proxy.example:8080/'),
    'urlInvalid',
  )
  assert.equal(
    validateConnectionProxyUrl('http_connect', 'HTTP://proxy.example:8080'),
    'schemeMismatch',
  )
  assert.equal(
    validateConnectionProxyUrl('socks5', 'http://proxy.example:1080'),
    'schemeMismatch',
  )
  assert.equal(
    validateConnectionProxyUrl('socks5', 'socks5://proxy.example'),
    'explicitPortRequired',
  )
})

test('代理名称归一化后不允许重名', () => {
  const existing: ConnectionProxy[] = [{
    id: 'proxy-1',
    name: '办公 网络',
    type: 'http_connect',
    url: 'http://proxy.example:8080',
    bound_host_count: 2,
  }]
  const input = normalizeConnectionProxyInput({
    name: '  办公   网络  ',
    type: 'socks5',
    url: '  socks5://proxy.example:1080  ',
  })

  assert.equal(input.name, '办公 网络')
  assert.equal(input.url, 'socks5://proxy.example:1080')
  assert.equal(validateConnectionProxyInput(input, existing).name, 'nameDuplicate')
  assert.equal(validateConnectionProxyInput(input, existing, 'proxy-1').name, undefined)
})
