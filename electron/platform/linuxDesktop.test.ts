import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { desktopIdentity } from '#common/desktop-identity'
import { prepareLinuxDevelopmentEntry } from './linuxDesktop.ts'

test('Linux 开发入口支持特殊路径和工作区移动，拒绝覆盖其他应用入口', async t => {
  const root = path.resolve('../TEMP/desktop-linux-tests')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(path.join(root, 'fixture-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const identity = desktopIdentity('development')
  const file = path.join(directory, 'applications', identity.desktopName)
  prepareLinuxDevelopmentEntry(identity, '/home/100%/$dev/"work"/Termous Dev', '/icon.png', directory)
  const entry = await readFile(file, 'utf8')
  assert.ok(entry.includes(String.raw`Exec="/home/100%%/\\$dev/\\"work\\"/Termous Dev"`))
  assert.ok(entry.includes('StartupWMClass=com.termous.app.development\n'))
  prepareLinuxDevelopmentEntry(identity, '/home/moved/Termous Dev', '/new-icon.png', directory)
  assert.ok((await readFile(file, 'utf8')).includes('Exec="/home/moved/Termous Dev"\n'))
  await writeFile(file, '[Desktop Entry]\nName=Other\nExec=/other\n')
  assert.throws(() => prepareLinuxDevelopmentEntry(identity, '/new/Termous Dev', '/icon.png', directory), /conflict/)
  assert.equal(await readFile(file, 'utf8'), '[Desktop Entry]\nName=Other\nExec=/other\n')
})
