import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseDocument } from 'yaml'

async function load(name) {
  const document = parseDocument(await readFile(new URL(`../../.github/${name}`, import.meta.url), 'utf8'), { uniqueKeys: true })
  assert.deepEqual(document.errors, [])
  return document.toJS()
}

test('CI 与 Release 共用三平台构建和同一份提交锁', async () => {
  const ci = await load('workflows/ci.yml')
  const release = await load('workflows/release.yml')
  const targets = [ ['windows', 'x64'], ['linux', 'x64'], ['macos', 'arm64'] ]
  for (const workflow of [ci, release]) {
    assert.deepEqual(workflow.jobs.build.strategy.matrix.include.map(v => [v.platform, v.arch]), targets)
    const setup = workflow.jobs.build.steps.find(s => s.uses === './web/.github/actions/buildtoolchain')
    assert.match(setup.with['source-lock'], /needs\..*outputs\.source_lock/)
    assert.equal(workflow.jobs.build.steps.filter(s => s.run?.includes('build.py build')).length, 1)
    assert.doesNotMatch(JSON.stringify(workflow), /macos-15-intel|merge-macos|resolve-core-dependencies/)
  }
  const ordinary = ci.jobs.sources.steps.find(s => s.id === 'sources')
  assert.match(ordinary.run, /--matching-branch/)
  const publishing = release.jobs.metadata.steps.find(s => s.id === 'sources')
  assert.doesNotMatch(publishing.run, /--matching-branch/)
  assert.match(publishing.run, /--web-sha/)
})

test('CI 保持只读且不消费 GitHub 发布凭据', async () => {
  const ci = await load('workflows/ci.yml')
  assert.deepEqual(ci.permissions, { contents: 'read' })
  assert.match(ci.jobs.sources.if, /head.repo.full_name == github.repository/)
  assert.doesNotMatch(JSON.stringify(ci), /contents.*write|gh release|upload-artifact|download-artifact|actions\/cache/)
  for (const job of Object.values(ci.jobs)) for (const step of job.steps ?? []) {
    if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false)
  }
})

test('CI 与 Release 仅在 Linux 构建步骤显式配置 Worker 隔离验收', async () => {
  for (const name of ['ci', 'release']) {
    const workflow = await load(`workflows/${name}.yml`)
    const configured = Object.values(workflow.jobs).flatMap(job => job.steps ?? [])
      .filter(step => step.env?.TERMOUS_ELECTRON_ACCEPTANCE_NO_SANDBOX !== undefined)
    assert.equal(configured.length, 1)
    assert.match(configured[0].run, /build\.py build/)
    assert.match(configured[0].run, /xvfb-run/)
    assert.equal(configured[0].env.TERMOUS_ELECTRON_ACCEPTANCE_NO_SANDBOX,
      "${{ matrix.platform == 'linux' && '1' || '0' }}")
    assert.doesNotMatch(JSON.stringify(workflow.env ?? {}), /ACCEPTANCE_NO_SANDBOX/)
  }
})

test('工具准备在固定源码检出后读取版本，Git 令牌不流入编译工具', async () => {
  const action = await load('actions/buildtoolchain/action.yml')
  const steps = action.runs.steps
  const checkout = steps.findIndex(s => s.name === 'Checkout locked sources')
  assert.ok(checkout >= 0)
  for (const name of ['setup-go', 'setup-node', 'action-setup']) {
    assert.ok(steps.findIndex(s => s.uses?.includes(name + '@')) > checkout)
  }
  const tokenSteps = steps.filter(s => s.env?.TERMOUS_REPOSITORIES_READ_TOKEN)
  assert.deepEqual(tokenSteps.map(s => s.name), ['Checkout locked sources'])
  assert.ok(steps.some(s => s.run?.includes('libfuse3-dev')))
  assert.ok(steps.some(s => s.run?.includes('macfuse')))
})

test('MinIO 归档遵循分支与发布规则，仅使用本次报告且取消后停止', async () => {
  for (const name of ['ci', 'release']) {
    const w = await load(`workflows/${name}.yml`)
    const steps = w.jobs.build.steps
    const build = steps.find(s => s.id === 'desktop-build')
    const archive = steps.find(s => s.name === 'Archive build artifacts')
    assert.match(build.run, /build\.py build --no-upload/)
    assert.equal(build.env.TERMOUS_ARCHIVE_KIND, name)
    assert.match(build.env.TERMOUS_ARCHIVE_STARTED, /needs\..*outputs.archive_started/)
    assert.match(archive.if, /!cancelled\(\)/)
    assert.match(archive.if, /steps.desktop-build.outputs.run_report != ''/)
    if (name === 'ci') {
      assert.equal(w.on.workflow_dispatch, null)
      assert.equal(archive.if, "${{ !cancelled() && github.ref == 'refs/heads/main' && steps.desktop-build.outputs.run_report != '' }}")
    } else {
      assert.equal(w.on.workflow_dispatch.inputs.upload.type, 'boolean')
      assert.equal(w.on.workflow_dispatch.inputs.upload.default, false)
      assert.match(archive.if, /inputs.upload == true/)
      assert.match(archive.if, /vars.TERMOUS_UPLOAD_ARTIFACTS == 'true'/)
    }
    assert.equal(archive.env.RUN_REPORT, '${{ steps.desktop-build.outputs.run_report }}')
    assert.match(archive.run, /build\.py upload.*--report "\$RUN_REPORT"/)
    assert.equal(archive['continue-on-error'], undefined)
    assert.ok(steps.indexOf(archive) > steps.indexOf(build))
    const credentialSteps = Object.values(w.jobs).flatMap(job => job.steps ?? [])
      .filter(s => Object.keys(s.env ?? {}).some(key => key.startsWith('TERMOUS_MINIO_')))
    assert.deepEqual(credentialSteps.map(s => s.name), ['Archive build artifacts'])
    for (const key of ['ACCESS_KEY', 'SECRET_KEY', 'SESSION_TOKEN']) {
      assert.equal(archive.env[`TERMOUS_MINIO_${key}`], '${{ secrets.TERMOUS_MINIO_' + key + ' }}')
    }
    if (name === 'release') assert.ok(steps.indexOf(archive) < steps.findIndex(s => s.name.startsWith('Upload')))
  }
  const ci = await load('workflows/ci.yml')
  const release = await load('workflows/release.yml')
  assert.equal(ci.jobs.sources.outputs.archive_started, '${{ steps.sources.outputs.archive_started }}')
  assert.equal(release.jobs.metadata.outputs.archive_started, '${{ steps.sources.outputs.archive_started }}')
  assert.equal(release.jobs['prepare-release'].outputs.archive_started, '${{ needs.metadata.outputs.archive_started }}')
  const action = await load('actions/buildtoolchain/action.yml')
  assert.ok(action.runs.steps.some(s => s.run === 'python termous-buildtools/ci.py bootstrap'))
  assert.ok(action.runs.steps.every(s => !s.run?.includes('pip install ./termous-buildtools')))
})
