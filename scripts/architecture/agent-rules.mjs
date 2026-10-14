import { isTestSource, relativeProjectPath } from './source-graph.mjs'

// 这是固定运行时的依赖清单，不通过类型导入或公共转导出放宽进程边界。
const dependencies = new Map(Object.entries({
  contracts: [],
  provider: ['contracts'],
  skills: ['contracts'],
  context: ['contracts', 'provider'],
  execution: ['contracts', 'provider'],
  tools: ['contracts', 'execution'],
  runtime: ['contracts', 'provider', 'context', 'execution', 'tools'],
  worker: ['contracts', 'runtime', 'tools'],
  host: ['contracts', 'skills'],
}))

function agentModule(relativePath) {
  const parts = relativePath.split('/')
  if (parts[0] !== 'electron' || parts[1] !== 'agent') return undefined
  return parts.length >= 4 ? parts[2] : ''
}

function externalEntryAllowed(source, target, module) {
  if (!source.startsWith('electron/')) return false
  if (source === 'electron/preload.ts') return target === 'electron/agent/contracts/ipcChannels.ts'
  if (module === 'contracts') return true
  if (target === 'electron/agent/host/index.ts') return source === 'electron/main.ts'
  if (target === 'electron/agent/skills/index.ts') return source === 'electron/main.ts' || source.startsWith('electron/skills/')
  return target === 'electron/agent/provider/index.ts' && source.startsWith('electron/terminalCompletion/')
}

export function collectAgentViolations(graph) {
  const violations = []
  for (const file of graph.productionSourceFiles) {
    const source = relativeProjectPath(graph.projectRoot, file)
    const module = agentModule(source)
    if (module !== undefined && !dependencies.has(module)) {
      violations.push({ rule: 'agent-module-location', source })
    }
  }
  for (const edge of graph.edges) {
    // 测试辅助的生产引用由统一的 production-test-import 规则报告。
    if (isTestSource(graph.projectRoot, edge.targetFile)) continue
    const source = relativeProjectPath(graph.projectRoot, edge.sourceFile)
    const target = relativeProjectPath(graph.projectRoot, edge.targetFile)
    const from = agentModule(source)
    const to = agentModule(target)
    const base = { source, target, specifier: edge.specifier, kind: edge.kind }
    if (from !== undefined && to !== undefined) {
      if (from !== to && !dependencies.get(from)?.includes(to)) {
        violations.push({ rule: 'agent-module-direction', ...base })
      } else if (from === to && source !== target && target === `electron/agent/${to}/index.ts`) {
        violations.push({ rule: 'agent-internal-public-entry', ...base })
      }
    } else if (to !== undefined && !externalEntryAllowed(source, target, to)) {
      violations.push({ rule: 'agent-public-entry', ...base })
    } else if (from !== undefined && !target.startsWith('common/')) {
      // 只有宿主需要现有 Core 进程配置的类型；Worker 不能借外部模块回导主进程。
      if (!(from === 'host' && target === 'electron/coreProcess.ts' && edge.kind === 'type')) {
        violations.push({ rule: 'agent-external-dependency', ...base })
      }
    }
  }
  for (const imported of graph.externalImports) {
    const source = relativeProjectPath(graph.projectRoot, imported.sourceFile)
    const module = agentModule(source)
    if (module === undefined) continue
    const base = { source, specifier: imported.specifier, kind: imported.kind }
    // 合同可使用快照哈希，其他第三方能力只能作为纯类型进入。
    if (module === 'contracts' && imported.kind !== 'type' && imported.specifier !== 'node:crypto') {
      violations.push({ rule: 'agent-contract-runtime-import', ...base })
    }
    if (module !== 'host' && imported.kind !== 'type'
      && (imported.specifier === 'electron' || imported.specifier.startsWith('electron/'))) {
      violations.push({ rule: 'agent-electron-runtime-import', ...base })
    }
  }
  return violations
}
