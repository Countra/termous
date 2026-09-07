import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const indexPath = fileURLToPath(new URL('../../index.html', import.meta.url))

function readContentSecurityPolicy() {
  const html = fs.readFileSync(indexPath, 'utf8')
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? []
  const policyTags = metaTags.filter((tag) => (
    /http-equiv\s*=\s*["']Content-Security-Policy["']/i.test(tag)
  ))
  assert.equal(policyTags.length, 1)

  const contentMatch = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(policyTags[0] ?? '')
  const content = contentMatch?.[1] ?? contentMatch?.[2]
  assert.ok(content)

  const directives = new Map<string, string[]>()
  for (const rawDirective of content.split(';')) {
    const parts = rawDirective.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) {
      continue
    }
    const [name, ...sources] = parts
    assert.equal(directives.has(name), false, `CSP 指令重复：${name}`)
    directives.set(name, sources)
  }
  return directives
}

test('Renderer CSP 精确覆盖本机 Core 与本地运行资源', () => {
  assert.deepEqual(Object.fromEntries(readContentSecurityPolicy()), {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': [
      "'self'",
      'data:',
      'blob:',
      'http://127.0.0.1:*',
      'http://localhost:*',
    ],
    'font-src': [
      "'self'",
      'data:',
      'http://127.0.0.1:*',
      'http://localhost:*',
    ],
    'connect-src': [
      "'self'",
      'http://127.0.0.1:*',
      'ws://127.0.0.1:*',
      'http://localhost:*',
      'ws://localhost:*',
    ],
    'worker-src': ["'self'", 'blob:'],
    'frame-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'none'"],
  })
})

test('Renderer CSP 不允许宽泛网络来源', () => {
  const forbiddenSources = new Set(['*', 'http:', 'https:', 'ws:', 'wss:'])
  for (const [directive, sources] of readContentSecurityPolicy()) {
    for (const source of sources) {
      assert.equal(
        forbiddenSources.has(source),
        false,
        `${directive} 不应允许宽泛来源 ${source}`,
      )
    }
  }
})
