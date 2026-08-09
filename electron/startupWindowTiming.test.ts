import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const mainSource = readFileSync(fileURLToPath(new URL('./main.ts', import.meta.url)), 'utf8')

test('启动窗口从首次可见时刻保证最短展示时间', () => {
  assert.match(mainSource, /const STARTUP_MIN_VISIBLE_MS = 650/)
  assert.match(mainSource, /let splashShownAt: number \| null = null/)
  assert.match(
    mainSource,
    /target\.once\('ready-to-show',[\s\S]*splashReadyForDisplay = true\s*showSplashWindow\(\)/,
  )
  assert.match(
    mainSource,
    /if \(!splashReadyForDisplay\) \{\s*return\s*\}/,
  )
  assert.match(
    mainSource,
    /target\.webContents\.once\('did-finish-load',[\s\S]*if \(!splashReadyForDisplay\)[\s\S]*showSplashWindow\(\)/,
  )
  assert.match(
    mainSource,
    /function showSplashWindow[\s\S]*if \(splashShownAt === null\) \{\s*splashShownAt = Date\.now\(\)/,
  )
  assert.match(
    mainSource,
    /if \(target && !target\.isDestroyed\(\)\) \{\s*if \(splashShownAt === null\) \{\s*return\s*\}/,
  )
  assert.match(
    mainSource,
    /STARTUP_MIN_VISIBLE_MS - \(Date\.now\(\) - splashShownAt\)/,
  )
  assert.doesNotMatch(mainSource, /splashStartedAt/)
})

test('启动窗口重复显示不重置计时且加载失败可直接收口', () => {
  assert.match(
    mainSource,
    /if \(splashShownAt === null\) \{\s*splashShownAt = Date\.now\(\)\s*\}/,
  )
  assert.match(
    mainSource,
    /\.loadFile\([\s\S]*\.catch\(\(\) => \{[\s\S]*closeSplashWindow\(\)\s*tryCompleteStartup\(\)/,
  )
  assert.match(
    mainSource,
    /function closeSplashWindow[\s\S]*clearTimeout\(startupCompletionTimer\)[\s\S]*startupCompletionTimer = null/,
  )
  assert.match(
    mainSource,
    /if \(focus\) \{\s*splashFocusRequested = true[\s\S]*if \(splashFocusRequested\) \{\s*target\.focus\(\)\s*splashFocusRequested = false/,
  )
  assert.match(mainSource, /showSplashWindow\(true\)/)
})
