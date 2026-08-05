import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runArchitectureCheck } from './check.mjs'
import {
  collectArchitectureViolations,
  expectedPackageImports,
} from './rules.mjs'

function writeFile(projectRoot, relativePath, content) {
  const filePath = path.join(projectRoot, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function createFixture(t, files = {}, options = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'termous-architecture-'))
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }))
  writeFile(projectRoot, 'package.json', JSON.stringify({
    name: 'architecture-fixture',
    private: true,
    type: 'module',
    imports: options.imports ?? expectedPackageImports,
  }, null, 2))
  writeFile(projectRoot, 'tsconfig.json', JSON.stringify({
    compilerOptions: {
      module: 'ESNext',
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      noEmit: true,
    },
    include: ['src', 'electron', 'common'],
  }, null, 2))
  writeFile(projectRoot, 'scripts/architecture/legacy-allowlist.json', JSON.stringify(
    options.allowlist ?? { schemaVersion: 1, violations: [] },
    null,
    2,
  ))
  for (const [relativePath, content] of Object.entries(files)) {
    writeFile(projectRoot, relativePath, content)
  }
  return projectRoot
}

function violationsFor(t, files, options) {
  return collectArchitectureViolations(createFixture(t, files, options))
}

test('受管源码根中的符号链接不能绕过架构检查', (t) => {
  const projectRoot = createFixture(t, {
    'common/contracts/index.ts': 'export const contract = true\n',
  })
  const linkPath = path.join(projectRoot, 'electron', 'linked')
  fs.mkdirSync(path.dirname(linkPath), { recursive: true })
  try {
    fs.symlinkSync(
      path.join(projectRoot, 'common', 'contracts'),
      linkPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
  } catch (error) {
    if (['EACCES', 'EPERM', 'UNKNOWN'].includes(error?.code)) {
      t.skip('当前环境不允许创建测试用符号链接')
      return
    }
    throw error
  }

  assert.throws(
    () => collectArchitectureViolations(projectRoot),
    /受管源码根不允许符号链接: electron\/linked/u,
  )
})

test('合法的公共入口和向下层依赖不产生违规', (t) => {
  const violations = violationsFor(t, {
    'src/features/hosts/index.ts': 'export const hosts = true\n',
    'src/pages/home/index.ts': "import { hosts } from '#features/hosts'\nexport const home = hosts\n",
  })
  assert.deepEqual(violations, [])
})

test('下层反向依赖上层会被标记', (t) => {
  const violations = violationsFor(t, {
    'src/features/connect/index.ts': 'export const connect = true\n',
    'src/entities/host/index.ts': "import { connect } from '#features/connect'\nexport const host = connect\n",
  })
  assert.equal(violations.filter((item) => item.rule === 'layer-direction').length, 1)
})

test('旧结构内部及其与目标层之间的依赖全部冻结', (t) => {
  const violations = violationsFor(t, {
    'src/api/client.ts': 'export const client = true\n',
    'src/components/LegacyOne.ts': "import { client } from '../api/client'\nexport const one = client\n",
    'src/components/LegacyTwo.ts': "import { hosts } from '#features/hosts'\nexport const two = hosts\n",
    'src/components/LegacyThree.ts': 'export const three = true\n',
    'src/features/hosts/index.ts': "import { three } from '../../components/LegacyThree'\nexport const hosts = three\n",
  })
  assert.equal(violations.filter((item) => item.rule === 'legacy-boundary').length, 3)
  assert.equal(violations.filter((item) => item.rule === 'legacy-file').length, 4)
})

test('同一 Slice 内使用别名或相对回导自身入口都会被拒绝', (t) => {
  const violations = violationsFor(t, {
    'src/features/hosts/index.ts': 'export const hosts = true\n',
    'src/features/hosts/model.ts': "import { hosts } from '#features/hosts'\nexport const model = hosts\n",
    'src/features/hosts/relative-model.ts': "import { hosts } from './index'\nexport const model = hosts\n",
  })
  assert.equal(violations.filter((item) => item.rule === 'slice-internal-alias').length, 1)
  assert.equal(violations.filter((item) => item.rule === 'slice-internal-public-entry').length, 1)
})

test('common 按 Slice 暴露公共合同并保持单向依赖', (t) => {
  const violations = violationsFor(t, {
    'common/contracts/index.ts': "export type { Contract } from './internal'\n",
    'common/contracts/internal.ts': 'export interface Contract { id: string }\n',
    'common/consumer/index.ts': "import type { Contract } from '#common/contracts'\nexport type Consumer = Contract\n",
    'electron/consumer.ts': "import type { Contract } from '#common/contracts'\nexport type ElectronContract = Contract\n",
    'src/features/hosts/index.ts': "import type { Contract } from '#common/contracts'\nexport type HostContract = Contract\n",
  })
  assert.deepEqual(violations, [])
})

test('common 根文件、内部别名、跨 Slice 深层导入和反向依赖都会被拒绝', (t) => {
  const violations = violationsFor(t, {
    'common/root.ts': 'export const root = true\n',
    'common/contracts/index.ts': 'export interface Contract { id: string }\n',
    'common/contracts/internal.ts': "import type { Contract } from '#common/contracts'\nexport type Internal = Contract\n",
    'common/consumer/index.ts': "import type { Internal } from '../contracts/internal'\nexport type Consumer = Internal\n",
    'common/invalid/index.ts': "import type { Host } from '../../src/features/hosts/index'\nexport type Invalid = Host\n",
    'electron/consumer.ts': "import type { Internal } from '../common/contracts/internal'\nexport type ElectronContract = Internal\n",
    'src/features/hosts/index.ts': 'export interface Host { id: string }\n',
  })
  assert.equal(violations.filter((item) => item.rule === 'layer-root-file').length, 1)
  assert.equal(violations.filter((item) => item.rule === 'slice-internal-alias').length, 1)
  assert.equal(violations.filter((item) => item.rule === 'same-layer-deep-import').length, 1)
  assert.equal(violations.filter((item) => item.rule === 'layer-direction').length, 1)
  assert.equal(violations.filter((item) => item.rule === 'public-entry').length, 3)
})

test('纯 re-export 兼容出口免除依赖边但仍保留旧文件债务', (t) => {
  const violations = violationsFor(t, {
    'src/components/HostsCompat.ts': [
      '// 兼容旧路径期间只委托新的公共入口。',
      "export { hosts } from '#features/hosts'",
      "export type { Host } from '#features/hosts'",
      '',
    ].join('\n'),
    'src/features/hosts/index.ts': 'export const hosts = true\nexport interface Host { id: string }\n',
  })
  assert.equal(violations.filter((item) => item.rule === 'legacy-file').length, 1)
  assert.equal(violations.filter((item) => item.rule === 'legacy-boundary').length, 0)
})

test('Sliced Layer 根债务迁移后可以保留纯 re-export 兼容出口', (t) => {
  const violations = violationsFor(t, {
    'src/shared/runtimeCompat.ts': "export { runtime } from '#shared/runtime'\n",
    'src/shared/runtime/index.ts': 'export const runtime = true\n',
  })
  assert.equal(violations.filter((item) => item.rule === 'layer-root-file').length, 1)
  assert.equal(violations.filter((item) => item.rule === 'legacy-boundary').length, 0)
})

test('旧 Renderer 根入口可以纯 re-export 到 app 模块公共入口', (t) => {
  const violations = violationsFor(t, {
    'src/App.ts': "export { app } from '#app/shell'\n",
    'src/app/shell/index.ts': 'export const app = true\n',
  })
  assert.equal(violations.filter((item) => item.rule === 'legacy-file').length, 1)
  assert.equal(violations.filter((item) => item.rule === 'legacy-boundary').length, 0)
})

test('普通 import facade、混合逻辑和多目标 re-export 不享受兼容例外', (t) => {
  const violations = violationsFor(t, {
    'src/components/EmptyFacade.ts': "export {} from '#features/hosts'\n",
    'src/components/ImportFacade.ts': "import { hosts } from '#features/hosts'\nexport { hosts }\n",
    'src/components/LogicFacade.ts': "export { hosts } from '#features/hosts'\nexport const local = true\n",
    'src/components/MultiFacade.ts': "export { hosts } from '#features/hosts'\nexport { settings } from '#features/settings'\n",
    'src/features/hosts/index.ts': 'export const hosts = true\n',
    'src/features/settings/index.ts': 'export const settings = true\n',
  })
  assert.equal(violations.filter((item) => item.rule === 'legacy-boundary').length, 5)
})

test('生产源码导入测试模块会被明确标记', (t) => {
  const violations = violationsFor(t, {
    'src/features/hosts/index.ts': "import './internal.test'\nexport const hosts = true\n",
    'src/features/hosts/internal.test.ts': "import './ignored-by-production-graph'\n",
    'src/features/hosts/ignored-by-production-graph.ts': 'export const ignored = true\n',
  })
  assert.equal(violations.filter((item) => item.rule === 'production-test-import').length, 1)
  assert.equal(violations.filter((item) => item.rule === 'import-cycle').length, 0)
})

test('跨 Slice 深层导入同时违反公共入口和同层边界', (t) => {
  const violations = violationsFor(t, {
    'src/features/alpha/index.ts': "import { internal } from '../beta/internal'\nexport const alpha = internal\n",
    'src/features/beta/internal.ts': 'export const internal = true\n',
  })
  assert.equal(violations.filter((item) => item.rule === 'public-entry').length, 1)
  assert.equal(violations.filter((item) => item.rule === 'same-layer-deep-import').length, 1)
})

test('解析到受管目录外的本地源码会被明确标记', (t) => {
  const violations = violationsFor(t, {
    'src/features/hosts/index.ts': "import { helper } from '../../../tooling/helper'\nexport const hosts = helper\n",
    'tooling/helper.ts': 'export const helper = true\n',
  })
  assert.deepEqual(violations.filter((item) => item.rule === 'out-of-scope-local-import'), [{
    rule: 'out-of-scope-local-import',
    source: 'src/features/hosts/index.ts',
    target: 'tooling/helper.ts',
    specifier: '../../../tooling/helper',
  }])
})

test('相对导入到项目根外的本地源码不会被静默忽略', (t) => {
  const projectRoot = createFixture(t)
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'termous-architecture-external-'))
  t.after(() => fs.rmSync(externalRoot, { recursive: true, force: true }))
  const externalFile = path.join(externalRoot, 'helper.ts')
  writeFile(externalRoot, 'helper.ts', 'export const helper = true\n')
  const sourceDirectory = path.join(projectRoot, 'src', 'features', 'hosts')
  const specifierPath = path.relative(sourceDirectory, externalFile).replaceAll(path.sep, '/')
  const specifier = specifierPath.startsWith('.') ? specifierPath : `./${specifierPath}`
  writeFile(
    projectRoot,
    'src/features/hosts/index.ts',
    `import { helper } from '${specifier}'\nexport const hosts = helper\n`,
  )

  const violations = collectArchitectureViolations(projectRoot)
  const outside = violations.filter((item) => item.rule === 'out-of-scope-local-import')
  assert.equal(outside.length, 1)
  assert.ok(outside[0].target.startsWith('../'))
})

test('错误大小写的本地路径在大小写敏感与不敏感平台都会失败', (t) => {
  const violations = violationsFor(t, {
    'src/features/hosts/index.ts': "import { model } from './Model'\nexport const hosts = model\n",
    'src/features/hosts/model.ts': 'export const model = true\n',
  })
  assert.equal(violations.filter((item) => item.rule === 'import-path-case').length, 1)
})

test('无扩展名导入声明文件不会被误报为路径大小写错误', (t) => {
  const violations = violationsFor(t, {
    'src/features/hosts/index.ts': "import type { Model } from './model'\nexport type HostModel = Model\n",
    'src/features/hosts/model.d.ts': 'export interface Model { id: string }\n',
  })
  assert.equal(violations.filter((item) => item.rule === 'import-path-case').length, 0)
})

test('生产源码中的三斜线 path 引用不能绕过依赖图', (t) => {
  const violations = violationsFor(t, {
    'src/features/hosts/index.ts': '/// <reference path="./internal.d.ts" />\nexport const hosts = true\n',
    'src/features/hosts/internal.d.ts': 'declare const internal: true\n',
  })
  assert.deepEqual(
    violations.filter((item) => item.rule === 'triple-slash-path-reference'),
    [{
      rule: 'triple-slash-path-reference',
      source: 'src/features/hosts/index.ts',
      specifier: './internal.d.ts',
    }],
  )
})

test('静态、动态、类型、自环及多节点 SCC 循环都会被识别', (t) => {
  const violations = violationsFor(t, {
    'src/features/cycles/static-a.ts': "import './static-b'\n",
    'src/features/cycles/static-b.ts': "import './static-a'\n",
    'src/features/cycles/dynamic-a.ts': "void import('./dynamic-b', { with: { type: 'javascript' } })\n",
    'src/features/cycles/dynamic-b.ts': "import './dynamic-a'\n",
    'src/features/cycles/type-a.ts': "import type { B } from './type-b'\nexport type A = B\n",
    'src/features/cycles/type-b.ts': "import type { A } from './type-a'\nexport type B = A\n",
    'src/features/cycles/self.ts': "import './self'\n",
    'src/features/cycles/scc-a.ts': "import './scc-b'\n",
    'src/features/cycles/scc-b.ts': "import './scc-c'\n",
    'src/features/cycles/scc-c.ts': "import './scc-a'\n",
    'src/features/cycles/require-a.cjs': "require('./require-b.cjs')\n",
    'src/features/cycles/require-b.cjs': "require('./require-a.cjs')\n",
  })
  const cycles = violations.filter((item) => item.rule === 'import-cycle')
  const kinds = cycles.reduce((counts, item) => ({
    ...counts,
    [item.kind]: (counts[item.kind] ?? 0) + 1,
  }), {})
  assert.equal(cycles.length, 12)
  assert.deepEqual(kinds, { dynamic: 1, static: 9, type: 2 })
  assert.ok(cycles.every((item) => !item.source.includes('\\') && !item.target.includes('\\')))
})

test('Sliced Layer 根文件作为精确债务记录', (t) => {
  const violations = violationsFor(t, {
    'src/shared/helper.ts': 'export const helper = true\n',
  })
  assert.deepEqual(violations, [{
    rule: 'layer-root-file',
    source: 'src/shared/helper.ts',
  }])
})

test('过期 allowlist 会导致检查失败', (t) => {
  const projectRoot = createFixture(t, {
    'common/contracts/index.ts': 'export const contract = true\n',
  }, {
    allowlist: {
      schemaVersion: 1,
      violations: [{ rule: 'layer-root-file', source: 'src/shared/removed.ts' }],
    },
  })
  const errors = []
  const result = runArchitectureCheck({
    projectRoot,
    stderr: (message) => errors.push(message),
    stdout: () => undefined,
  })
  assert.equal(result.exitCode, 1)
  assert.equal(result.stale.length, 1)
  assert.ok(errors.some((message) => message.includes('[过期架构债务]')))
})

test('Alias 缺失、目标漂移或额外声明都会中止检查', async (t) => {
  const cases = [
    Object.fromEntries(Object.entries(expectedPackageImports).filter(([key]) => key !== '#shared/*')),
    { ...expectedPackageImports, '#features/*': './src/features/*/public.ts' },
    { ...expectedPackageImports, '#legacy/*': './src/legacy/*/index.ts' },
  ]
  for (const imports of cases) {
    await t.test(JSON.stringify(imports), (nested) => {
      const projectRoot = createFixture(nested, {}, { imports })
      assert.throws(
        () => collectArchitectureViolations(projectRoot),
        /package\.json#imports 与架构合同不一致/,
      )
    })
  }
})
