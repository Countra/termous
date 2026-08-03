import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

type TranslationTree = Record<string, unknown>

const sourceRoot = fileURLToPath(new URL('../', import.meta.url))
const zhCN = readTranslations('zh-CN')
const enUS = readTranslations('en-US')

test('中英文翻译资源拥有一致的键集合', () => {
  assert.deepEqual(canonicalKeys(zhCN), canonicalKeys(enUS))
})

test('代码中的字面量翻译键均已配置', () => {
  const missing = new Set<string>()
  for (const file of sourceFiles(sourceRoot)) {
    const content = readFileSync(file, 'utf8')
    const pattern = /(?<![A-Za-z0-9_])t\(\s*['"]([^'"]+)['"]/g
    for (const match of content.matchAll(pattern)) {
      if (!hasTranslation(zhCN, match[1]) || !hasTranslation(enUS, match[1])) {
        missing.add(match[1])
      }
    }
  }
  assert.deepEqual([...missing].sort(), [])
})

test('端口转发实时速度文案和格式保持一致', () => {
  assert.equal(translationValue(zhCN, 'forwards.sendRate'), '发送速度')
  assert.equal(translationValue(zhCN, 'forwards.receiveRate'), '接收速度')
  assert.equal(translationValue(enUS, 'forwards.sendRate'), 'Send rate')
  assert.equal(translationValue(enUS, 'forwards.receiveRate'), 'Receive rate')
  assert.equal(translationValue(zhCN, 'forwards.totalTraffic'), '累计流量')
  assert.equal(translationValue(enUS, 'forwards.totalTraffic'), 'Total traffic')
  assert.equal(translationValue(zhCN, 'forwards.speedValue'), '{{value}}/s')
  assert.equal(translationValue(enUS, 'forwards.speedValue'), '{{value}}/s')
})

test('智能补全动态来源和设置文案在中英文资源中完整对应', () => {
  for (const source of ['native', 'alias', 'snippet', 'history', 'directory', 'other']) {
    const key = `terminal.completion.sources.${source}`
    assert.equal(typeof translationValue(zhCN, key), 'string', key)
    assert.equal(typeof translationValue(enUS, key), 'string', key)
  }
  for (const key of [
    'terminal.completion.label',
    'terminal.completion.exact',
    'settings.completionTitle',
    'settings.completionEnabled',
    'settings.completionHint',
    'settings.completionProviders',
    'settings.completionProvidersHint',
    'settings.completionProvidersEnabled',
    'settings.completionProvidersPaused',
  ]) {
    assert.equal(typeof translationValue(zhCN, key), 'string', key)
    assert.equal(typeof translationValue(enUS, key), 'string', key)
  }
  for (const source of ['native', 'alias', 'snippet', 'history', 'directory']) {
    for (const field of ['name', 'description']) {
      const key = `settings.completionProvider.${source}.${field}`
      assert.equal(typeof translationValue(zhCN, key), 'string', key)
      assert.equal(typeof translationValue(enUS, key), 'string', key)
    }
  }
})

function readTranslations(locale: string) {
  const path = join(sourceRoot, 'i18n', 'locales', locale, 'translation.json')
  return JSON.parse(readFileSync(path, 'utf8')) as TranslationTree
}

function sourceFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path))
    } else if (entry.isFile() && (extname(entry.name) === '.ts' || extname(entry.name) === '.tsx')) {
      files.push(path)
    }
  }
  return files
}

function canonicalKeys(tree: TranslationTree) {
  return [...new Set(flattenKeys(tree).map((key) => key.replace(/_(?:one|other)$/, '')))].sort()
}

function flattenKeys(tree: TranslationTree, prefix = ''): string[] {
  const keys: string[] = []
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as TranslationTree, path))
    } else {
      keys.push(path)
    }
  }
  return keys
}

function hasTranslation(tree: TranslationTree, key: string) {
  let current: unknown = tree
  const segments = key.split('.')
  for (const [index, segment] of segments.entries()) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return false
    }
    const node = current as TranslationTree
    if (!(segment in node)) {
      if (
        index === segments.length - 1
        && typeof node[`${segment}_one`] === 'string'
        && typeof node[`${segment}_other`] === 'string'
      ) {
        return true
      }
      return false
    }
    current = node[segment]
  }
  return typeof current === 'string' || typeof current === 'number'
}

function translationValue(tree: TranslationTree, key: string) {
  let current: unknown = tree
  for (const segment of key.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined
    }
    current = (current as TranslationTree)[segment]
  }
  return current
}
