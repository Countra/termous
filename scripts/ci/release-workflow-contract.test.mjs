import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseDocument } from 'yaml'

async function workflow() {
  const source = await readFile(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8')
  const document = parseDocument(source, { uniqueKeys: true })
  assert.deepEqual(document.errors, [])
  return document.toJS()
}

test('Release 保留标签保护、事件提交固定和串行发布', async () => {
  const w = await workflow()
  assert.deepEqual(w.permissions, { contents: 'read' })
  assert.deepEqual(w.concurrency, { group: 'release', 'cancel-in-progress': false })
  const metadata = JSON.stringify(w.jobs.metadata)
  assert.match(metadata, /github.ref_protected/)
  assert.match(metadata, /EVENT_SHA/)
  assert.match(metadata, /tag_sha/)
  assert.equal(w.jobs.metadata.environment, undefined)
  for (const job of Object.values(w.jobs)) for (const step of job.steps ?? []) {
    if (step.uses?.startsWith('actions/checkout@')) {
      assert.equal(step.with['persist-credentials'], false)
      assert.ok(step.with.ref)
    }
    if (step.uses && !step.uses.startsWith('./')) assert.match(step.uses, /@[a-f0-9]{40}$/)
  }
})

test('构建后完整保留 Draft、收据、内容摘要和发布前再次核对', async () => {
  const w = await workflow()
  assert.deepEqual(w.jobs['verify-release'].needs, ['prepare-release', 'build'])
  assert.deepEqual(w.jobs.publish.needs, ['prepare-release', 'verify-final-release'])
  assert.equal(w.jobs.publish.environment, 'release')
  const verify = JSON.stringify(w.jobs['verify-release'])
  assert.match(verify, /--phase receipts/)
  assert.match(verify, /content_fingerprint/)
  const publish = JSON.stringify(w.jobs.publish)
  assert.match(publish, /--phase final/)
  assert.match(publish, /EXPECTED_COMMIT/)
  assert.match(publish, /EXPECTED_FINGERPRINT/)
  assert.match(publish, /draft=false/)
  assert.doesNotMatch(JSON.stringify(w), /upload-artifact|download-artifact|GITHUB_RELEASE_TOKEN|latest-mac\.(?:x64|arm64)\.partial/)
  const uploads = w.jobs.build.steps.filter(s => s.name.startsWith('Upload'))
  assert.equal(uploads.length, 2)
  for (const step of uploads) {
    assert.equal(step.env.GH_TOKEN, '${{ github.token }}')
    assert.match(step.run, /isDraft/)
  }
})
