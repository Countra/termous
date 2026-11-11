import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileLogSink } from './sink.ts'

test('文件异步创建与串行轮转，只保留一份备份', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'termous-log-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const sink = fileLogSink(() => directory), target = path.join(directory, 'electron-process.log')
  await sink.write('first\n')
  for (let i = 0; i < 20; i++) await sink.write('x'.repeat(60 * 1024) + '\n')
  assert.deepEqual((await readdir(directory)).sort(), ['electron-process.log', 'electron-process.log.1'])
  assert.ok((await stat(target)).size <= 512 * 1024)
  assert.ok((await stat(target + '.1')).size <= 512 * 1024)
  assert.ok((await readFile(target, 'utf8')).endsWith('\n'))
})

test('轮转失败保留现有文件，下一次重试重新读取文件状态', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'termous-log-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const sink = fileLogSink(() => directory), target = path.join(directory, 'electron-process.log')
  await sink.write('x'.repeat(500 * 1024))
  await mkdir(target + '.1')
  await assert.rejects(sink.write('y'.repeat(30 * 1024)))
  assert.equal((await stat(target)).size, 500 * 1024)
  await rm(target + '.1', { recursive: true })
  await sink.write('recovered\n')
  assert.ok((await readFile(target, 'utf8')).endsWith('recovered\n'))
})
