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

test('CI 保持只读且不消费发布凭据或上传构建产物', async () => {
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
