import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8')
const preloadSource = readFileSync(new URL('./startup-preload.ts', import.meta.url), 'utf8')

test('主进程将真实窗口可见状态接入统一展示门禁', () => {
  assert.match(mainSource, /new StartupPresentation\(/)
  assert.match(mainSource, /function showSplashWindow[\s\S]*target\.show\(\)\s*startupPresentation\.setWindowVisible\(true\)/)
  assert.match(mainSource, /function closeSplashWindow[\s\S]*startupPresentation\.setWindowVisible\(false\)/)
  assert.match(mainSource, /startupPresentation\.getView\(\)\.canComplete && startupReadyRequested && mainWindowReady/)
  assert.doesNotMatch(mainSource, /startupCompletionTimer|splashShownAt|STARTUP_MIN_VISIBLE_MS/)
})

test('启动窗加载失败可跳过展示且只注入专用沙箱桥接', () => {
  assert.match(mainSource, /\.loadFile\([\s\S]*\.catch\(\(\) => \{[\s\S]*startupPresentation\.skipPresentation\(\)/)
  assert.match(mainSource, /preload: path\.join\(__dirname, 'startup-preload\.cjs'\),\s*contextIsolation: true,\s*nodeIntegration: false,\s*sandbox: true/)
  assert.match(preloadSource, /contextBridge\.exposeInMainWorld\('termousStartupBridge', bridge\)/)
  assert.doesNotMatch(preloadSource, /core:get-config|desktop:|local-files:|ssh:|AppConfig/)
})
