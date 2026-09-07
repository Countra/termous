import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isValidRemoteDesktopIPAddress,
  normalizeRemoteDesktopIPAddress,
} from './targetHost.ts'

test('VNC 直连目标接受可连接的 IPv4 与 IPv6 字面量', () => {
  for (const value of [
    '192.0.2.10',
    '240.0.0.1',
    '255.0.0.1',
    '2001:db8::10',
    '::1',
    '::ffff:192.0.2.10',
  ]) {
    assert.equal(isValidRemoteDesktopIPAddress(value), true, value)
  }
})

test('VNC 直连目标拒绝非 IP、不可连接地址和含 zone 的地址', () => {
  for (const value of [
    '',
    ' vnc.example.com ',
    'vnc.example.com',
    'https://192.0.2.10',
    '0.0.0.0',
    '::',
    '239.1.1.1',
    'ff02::1',
    '255.255.255.255',
    'fe80::1%eth0',
    '::ffff:0.0.0.0',
    '::ffff:255.255.255.255',
  ]) {
    assert.equal(isValidRemoteDesktopIPAddress(value), false, value)
  }
})

test('VNC 直连目标与后端使用相同的规范化语义', () => {
  assert.equal(normalizeRemoteDesktopIPAddress(' 2001:0DB8:0:0:0:0:0:10 '), '2001:db8::10')
  assert.equal(normalizeRemoteDesktopIPAddress('::ffff:192.0.2.10'), '192.0.2.10')
  assert.equal(normalizeRemoteDesktopIPAddress('vnc.example.com'), 'vnc.example.com')
})
