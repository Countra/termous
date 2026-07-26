import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { validateUpdateSimulationInputs } from './updateSimulationFixtureValidation.ts'

const expectedFeedURL = 'http://127.0.0.1:18991'

test('运行时 fixture 校验封闭更新源、路径、大小和 SHA512', async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'termous-update-runtime-fixture-'),
  )
  const resources = path.join(root, 'resources')
  const feed = path.join(root, 'feed')
  const installerName = 'Termous-Update-Simulation-0.0.2-setup.exe'
  const installer = Buffer.from('isolated-update-fixture', 'utf8')
  const digest = createHash('sha512').update(installer).digest('base64')
  try {
    await mkdir(resources, { recursive: true })
    await mkdir(feed, { recursive: true })
    await writeFile(
      path.join(resources, 'app-update.yml'),
      [
        'provider: generic',
        `url: ${expectedFeedURL}`,
        'useMultipleRangeRequest: false',
        'updaterCacheDirName: termous-update-simulation-updater',
      ].join('\n'),
    )
    await writeFile(path.join(feed, installerName), installer)
    await writeFile(path.join(feed, `${installerName}.blockmap`), 'blockmap')
    await writeManifest(feed, installerName, installer.byteLength, digest)

    const validated = await validateUpdateSimulationInputs(
      feed,
      resources,
      expectedFeedURL,
    )
    assert.deepEqual(validated, {
      name: installerName,
      size: installer.byteLength,
      sha512: digest,
    })

    await writeManifest(
      feed,
      'https://example.invalid/escaped.exe',
      installer.byteLength,
      digest,
    )
    await assert.rejects(
      validateUpdateSimulationInputs(feed, resources, expectedFeedURL),
      /无效或越界/,
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

function writeManifest(
  feed: string,
  installerName: string,
  size: number,
  sha512: string,
) {
  return writeFile(
    path.join(feed, 'latest.yml'),
    [
      'version: 0.0.2',
      'files:',
      `  - url: ${installerName}`,
      `    sha512: ${sha512}`,
      `    size: ${size}`,
      `path: ${installerName}`,
      `sha512: ${sha512}`,
    ].join('\n'),
  )
}
