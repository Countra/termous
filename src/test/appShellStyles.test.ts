import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

function readSource(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

const appShellSource = readSource('../app/app-shell/ui/AppShell.tsx')
const windowControlsSource = readSource('../app/app-shell/ui/WindowControls.tsx')
const appSource = readSource('../app/main/App.tsx')
const appShellStyles = readSource('../app/app-shell/ui/AppShell.module.scss')
const windowControlsStyles = readSource('../app/app-shell/ui/WindowControls.module.scss')
const appStyles = readSource('../app/main/App.module.scss')
const sharedStyles = readSource('../shared/styles/workstation.scss')

test('应用壳层和窗口控制使用共置 SCSS Modules', () => {
  assert.match(appShellSource, /import styles from '\.\/AppShell\.module\.scss'/)
  assert.match(appShellSource, /styles\['app-shell'\]/)
  assert.match(appShellSource, /classNames=\{\{ root: styles\['topbar-connect-dropdown'\] \}\}/)
  assert.match(windowControlsSource, /import styles from '\.\/WindowControls\.module\.scss'/)
  assert.match(windowControlsSource, /styles\['window-controls'\]/)
  assert.match(appSource, /styles\['app-keepalive-page'\]/)
  assert.match(appSource, /styles\['core-fatal-modal'\]/)
})

test('应用壳层独占选择器不再由共享全局样式承载', () => {
  for (const className of [
    'app-shell',
    'sidebar',
    'brand-row',
    'primary-nav',
    'main-frame',
    'window-chrome',
    'topbar-connect-group',
    'window-controls',
    'content-frame',
    'app-keepalive-page',
    'app-inline-status',
    'core-fatal-modal',
  ]) {
    assert.doesNotMatch(sharedStyles, new RegExp(`\\.${className}(?=[\\s.:,{])`))
  }
})

test('应用壳层模块保留布局、Portal 和窄窗口合同', () => {
  assert.match(
    appShellStyles,
    /\.app-shell\s*\{[\s\S]*grid-template-columns:\s*var\(--sidebar-width\) minmax\(0, 1fr\);/,
  )
  assert.match(appShellStyles, /\.topbar-connect-dropdown:global\(\.ant-dropdown\)/)
  assert.match(
    appShellStyles,
    /\.nav-item:global\(\.ant-btn\):hover,[\s\S]*box-shadow:\s*var\(--inner-highlight\);/,
  )
  assert.match(
    appShellStyles,
    /\.nav-item:global\(\.ant-btn\):active\s*\{\s*transform:\s*translateY\(1px\);/,
  )
  assert.match(
    appShellStyles,
    /\.icon-button:global\(\.ant-btn\):active\s*\{\s*transform:\s*translateY\(1px\);/,
  )
  assert.match(appShellStyles, /@media \(width <= 760px\)/)
  assert.match(windowControlsStyles, /\.window-control:global\(\.ant-btn\):focus-visible/)
  assert.match(appStyles, /\.app-keepalive-page\.is-hidden/)
  assert.match(appStyles, /\.core-fatal-modal :global\(\.ant-modal-content\)/)
  assert.doesNotMatch(appShellStyles, /stylelint-disable termous\/no-unscoped-global/)
  assert.doesNotMatch(windowControlsStyles, /stylelint-disable termous\/no-unscoped-global/)
  assert.doesNotMatch(appStyles, /stylelint-disable termous\/no-unscoped-global/)
})
