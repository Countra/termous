import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  collectArchitectureViolations,
  violationKey,
} from './rules.mjs'

const scriptPath = fileURLToPath(import.meta.url)
const defaultProjectRoot = path.resolve(path.dirname(scriptPath), '../..')

function formatViolation(violation) {
  const target = violation.target ? ` -> ${violation.target}` : ''
  const importDetail = violation.specifier ? ` (${violation.specifier})` : ''
  const kindDetail = violation.kind ? ` [${violation.kind}]` : ''
  return `${violation.rule}: ${violation.source}${target}${importDetail}${kindDetail}`
}

function readAllowlist(allowlistPath) {
  const parsed = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.violations)) {
    throw new Error('架构债务清单格式无效，必须使用 schemaVersion 1 和 violations 数组')
  }
  const allowedFields = new Set(['rule', 'source', 'target', 'specifier', 'kind'])
  const seen = new Set()
  for (const violation of parsed.violations) {
    if (
      !violation
      || typeof violation !== 'object'
      || typeof violation.rule !== 'string'
      || typeof violation.source !== 'string'
      || ('target' in violation && typeof violation.target !== 'string')
      || ('specifier' in violation && typeof violation.specifier !== 'string')
      || ('kind' in violation && typeof violation.kind !== 'string')
      || Object.keys(violation).some((field) => !allowedFields.has(field))
    ) {
      throw new Error('架构债务清单包含字段不完整或无法识别的条目')
    }
    const key = violationKey(violation)
    if (seen.has(key)) {
      throw new Error(`架构债务清单包含重复条目: ${formatViolation(violation)}`)
    }
    seen.add(key)
  }
  return parsed.violations
}

export function compareArchitectureAllowlist(current, allowlist) {
  const currentByKey = new Map(current.map((item) => [violationKey(item), item]))
  const allowedByKey = new Map(allowlist.map((item) => [violationKey(item), item]))
  return {
    added: current.filter((item) => !allowedByKey.has(violationKey(item))),
    stale: allowlist.filter((item) => !currentByKey.has(violationKey(item))),
  }
}

function ruleSummary(violations) {
  const counts = new Map()
  for (const violation of violations) {
    counts.set(violation.rule, (counts.get(violation.rule) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([rule, count]) => `${rule}=${count}`)
    .join(', ')
}

export function runArchitectureCheck({
  projectRoot = defaultProjectRoot,
  allowlistPath = path.join(projectRoot, 'scripts/architecture/legacy-allowlist.json'),
  reportOnly = false,
  stdout = (message) => console.log(message),
  stderr = (message) => console.error(message),
} = {}) {
  const current = collectArchitectureViolations(projectRoot)
  if (reportOnly) {
    stdout(JSON.stringify({ schemaVersion: 1, violations: current }, null, 2))
    return { exitCode: 0, current, added: [], stale: [] }
  }
  const allowlist = readAllowlist(allowlistPath)
  const { added, stale } = compareArchitectureAllowlist(current, allowlist)
  if (added.length === 0 && stale.length === 0) {
    stdout(`架构边界检查通过：${current.length} 条历史债务保持精确匹配（${ruleSummary(current) || '无历史债务'}）`)
    return { exitCode: 0, current, added, stale }
  }
  for (const violation of added) {
    stderr(`[新增架构违规] ${formatViolation(violation)}`)
  }
  for (const violation of stale) {
    stderr(`[过期架构债务] ${formatViolation(violation)}`)
  }
  stderr('请修复新增违规；已消除的债务必须从 legacy-allowlist.json 删除。')
  return { exitCode: 1, current, added, stale }
}

function parseArguments(args) {
  const options = { projectRoot: defaultProjectRoot, reportOnly: false }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--report-json') {
      options.reportOnly = true
    } else if (argument === '--project-root' || argument === '--allowlist') {
      const value = args[index + 1]
      if (!value) {
        throw new Error(`${argument} 缺少路径参数`)
      }
      index += 1
      if (argument === '--project-root') {
        options.projectRoot = path.resolve(value)
      } else {
        options.allowlistPath = path.resolve(value)
      }
    } else {
      throw new Error(`无法识别的参数: ${argument}`)
    }
  }
  return options
}

function isMainModule() {
  if (!process.argv[1]) {
    return false
  }
  const invoked = path.resolve(process.argv[1])
  return process.platform === 'win32'
    ? invoked.toLowerCase() === scriptPath.toLowerCase()
    : invoked === scriptPath
}

if (isMainModule()) {
  try {
    const result = runArchitectureCheck(parseArguments(process.argv.slice(2)))
    process.exitCode = result.exitCode
  } catch (error) {
    console.error(`架构边界检查无法执行: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
