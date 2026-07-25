import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createUpdateSimulationFeed,
  parseSingleRange,
} from './feed-server.mjs'

test('单 Range 解析覆盖完整、后缀、截断和非法输入', () => {
  assert.equal(parseSingleRange(undefined, 10), null)
  assert.deepEqual(parseSingleRange('bytes=2-5', 10), { start: 2, end: 5 })
  assert.deepEqual(parseSingleRange('bytes=7-', 10), { start: 7, end: 9 })
  assert.deepEqual(parseSingleRange('bytes=-3', 10), { start: 7, end: 9 })
  assert.deepEqual(parseSingleRange('bytes=0-99', 10), { start: 0, end: 9 })
  assert.equal(parseSingleRange('bytes=10-', 10), 'invalid')
  assert.equal(parseSingleRange('bytes=1-2,4-5', 10), 'invalid')
})

test('loopback feed 支持 GET、HEAD、Range 与受保护故障注入', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'termous-update-feed-'))
  const token = 'termous-update-simulation-token'
  const installer = Buffer.from('0123456789abcdef', 'utf8')
  await writeFile(path.join(root, 'latest.yml'), 'version: 0.0.2\n', 'utf8')
  await writeFile(path.join(root, 'candidate.exe'), installer)
  const feed = await createUpdateSimulationFeed({
    rootDirectory: root,
    controlToken: token,
    slowDelayMs: 1,
  })

  try {
    const address = await feed.listen(0)
    assert.ok(address && typeof address === 'object')
    const baseURL = `http://127.0.0.1:${address.port}`

    const health = await fetch(`${baseURL}/healthz`)
    assert.equal(health.status, 200)
    assert.equal((await health.json()).fault_mode, 'normal')

    const head = await fetch(`${baseURL}/candidate.exe`, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.headers.get('content-length'), String(installer.byteLength))
    assert.equal(await head.text(), '')

    const range = await fetch(`${baseURL}/candidate.exe`, {
      headers: { Range: 'bytes=2-5' },
    })
    assert.equal(range.status, 206)
    assert.equal(range.headers.get('content-range'), 'bytes 2-5/16')
    assert.equal(await range.text(), '2345')

    const invalidRange = await fetch(`${baseURL}/candidate.exe`, {
      headers: { Range: 'bytes=0-1,4-5' },
    })
    assert.equal(invalidRange.status, 416)

    const traversal = await fetch(`${baseURL}/..%2fcandidate.exe`)
    assert.equal(traversal.status, 404)

    const forbidden = await fetch(`${baseURL}/__control`, {
      method: 'POST',
      body: JSON.stringify({ fault_mode: 'asset_404' }),
    })
    assert.equal(forbidden.status, 403)

    const controlled = await setFault(baseURL, token, 'asset_404')
    assert.equal(controlled.status, 200)
    assert.equal((await fetch(`${baseURL}/candidate.exe`)).status, 404)

    await setFault(baseURL, token, 'hash_mismatch')
    const corrupted = Buffer.from(
      await (await fetch(`${baseURL}/candidate.exe`)).arrayBuffer(),
    )
    assert.equal(corrupted.byteLength, installer.byteLength)
    assert.notDeepEqual(corrupted, installer)

    await setFault(baseURL, token, 'metadata_404')
    assert.equal((await fetch(`${baseURL}/latest.yml`)).status, 404)

    await setFault(baseURL, token, 'redirect_external')
    const redirect = await fetch(`${baseURL}/latest.yml`, {
      redirect: 'manual',
    })
    assert.equal(redirect.status, 302)
    assert.equal(
      redirect.headers.get('location'),
      'https://example.invalid/escaped-latest.yml',
    )
  } finally {
    await feed.close()
    await rm(root, { force: true, recursive: true })
  }
})

function setFault(baseURL, token, faultMode) {
  return fetch(`${baseURL}/__control`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Termous-Simulation-Token': token,
    },
    body: JSON.stringify({ fault_mode: faultMode }),
  })
}
