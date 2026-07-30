import assert from 'node:assert/strict'
import test from 'node:test'
import {
  externalUrlMaxBytes,
  openExternalUrl,
  validateExternalUrl,
} from './externalUrl.ts'

test('外链校验仅接受无凭据的 HTTP 和 HTTPS URL', () => {
  assert.deepEqual(
    validateExternalUrl('https://example.com/docs?q=termous#install'),
    { ok: true, url: 'https://example.com/docs?q=termous#install' },
  )
  assert.deepEqual(
    validateExternalUrl('http://例子.测试/路径'),
    { ok: true, url: 'http://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84' },
  )
  assert.deepEqual(
    validateExternalUrl('ssh://example.com'),
    { ok: false, error: 'external_url_protocol_not_allowed' },
  )
  assert.deepEqual(
    validateExternalUrl('https://user:secret@example.com'),
    { ok: false, error: 'external_url_credentials_not_allowed' },
  )
})

test('外链校验拒绝畸形、控制字符、外围空白和超长输入', () => {
  assert.deepEqual(
    validateExternalUrl('not a url'),
    { ok: false, error: 'external_url_invalid' },
  )
  assert.deepEqual(
    validateExternalUrl(' https://example.com'),
    { ok: false, error: 'external_url_invalid' },
  )
  assert.deepEqual(
    validateExternalUrl('https://example.com/\nnext'),
    { ok: false, error: 'external_url_invalid' },
  )
  assert.deepEqual(
    validateExternalUrl(`https://example.com/${'a'.repeat(externalUrlMaxBytes)}`),
    { ok: false, error: 'external_url_too_long' },
  )
})

test('外链打开只调用一次受控 opener 并归一化失败结果', async () => {
  const opened: string[] = []
  assert.deepEqual(
    await openExternalUrl('https://example.com', async (url) => {
      opened.push(url)
    }),
    { ok: true },
  )
  assert.deepEqual(opened, ['https://example.com/'])

  assert.deepEqual(
    await openExternalUrl('file:///tmp/secret', async (url) => {
      opened.push(url)
    }),
    { ok: false, error: 'external_url_protocol_not_allowed' },
  )
  assert.equal(opened.length, 1)

  assert.deepEqual(
    await openExternalUrl('https://example.com/failure', async () => {
      throw new Error('系统浏览器错误详情')
    }),
    { ok: false, error: 'external_url_open_failed' },
  )
})
