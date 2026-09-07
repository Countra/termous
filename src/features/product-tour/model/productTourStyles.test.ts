import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

function readSource(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

test('Driver 基础样式先于 Termous 全局覆盖加载', () => {
  const sharedStyles = readSource('../../../shared/styles/index.ts')
  const driverImport = sharedStyles.indexOf("import 'driver.js/dist/driver.css'")
  const globalImport = sharedStyles.indexOf("import './global.scss'")

  assert.ok(driverImport >= 0)
  assert.ok(globalImport > driverImport)
})

test('覆盖层和 Popover 分别受 body 状态与模块类约束', () => {
  const globalStyles = readSource('../../../shared/styles/global.scss')
  const tourStyles = readSource('../ui/ProductTour.module.scss')
  const antdTheme = readSource('../../../shared/theme/antdTheme.ts')
  const overlayZIndex = Number(globalStyles.match(/\.driver-overlay\s*\{[^}]*z-index:\s*(\d+)/s)?.[1])
  const popoverZIndex = Number(tourStyles.match(/\.popover:global\(\.driver-popover\)[^{]*\{[^}]*z-index:\s*(\d+)/s)?.[1])
  const portalZIndex = Number(antdTheme.match(/zIndexPopupBase:\s*(\d+)/)?.[1])

  assert.match(globalStyles, /body\[data-termous-product-tour='true'\]\) \.driver-overlay/)
  assert.match(tourStyles, /\.popover:global\(\.driver-popover\)/)
  assert.ok(overlayZIndex < popoverZIndex)
  assert.ok(popoverZIndex < portalZIndex)
  assert.doesNotMatch(globalStyles, /^\.driver-popover\s*\{/m)
})

test('Popover 的关键操作满足文本对比度和最小点击尺寸合同', () => {
  const tourStyles = readSource('../ui/ProductTour.module.scss')

  assert.match(tourStyles, /--product-tour-primary-bg:\s*#2059ad/)
  assert.match(tourStyles, /--product-tour-primary-bg-hover:\s*#2464c0/)
  assert.match(tourStyles, /--product-tour-primary-bg:\s*#1759c8/)
  assert.match(tourStyles, /--product-tour-primary-bg-hover:\s*#1b63d1/)
  assert.match(tourStyles, /driver-popover-progress-text\)[^{]*\{[^}]*color:\s*var\(--text-secondary\)/s)
  assert.match(tourStyles, /\.skip-button\s*\{[^}]*min-height:\s*24px/s)
  assert.match(tourStyles, /\.skip-button:focus-visible\s*\{[^}]*outline:\s*2px solid/s)
})

test('Popover 关闭按钮居中且箭头与卡片共享连续表面', () => {
  const tourStyles = readSource('../ui/ProductTour.module.scss')

  assert.match(tourStyles, /--product-tour-popover-bg:/)
  assert.match(tourStyles, /background:\s*var\(--product-tour-popover-bg\)/)
  assert.match(tourStyles, /driver-popover-close-btn\)[^{]*\{[^}]*display:\s*inline-flex\s*!important/s)
  assert.match(tourStyles, /driver-popover-close-btn\)[^{]*\{[^}]*width:\s*30px/s)
  assert.match(tourStyles, /driver-popover-close-btn\)[^{]*\{[^}]*height:\s*30px/s)
  assert.match(tourStyles, /driver-popover-close-btn\)[^{]*\{[^}]*align-items:\s*center/s)
  assert.match(tourStyles, /driver-popover-close-btn\)[^{]*\{[^}]*justify-content:\s*center/s)
  assert.match(tourStyles, /driver-popover-close-btn\)[^{]*\{[^}]*line-height:\s*0/s)
  assert.match(tourStyles, /driver-popover-close-btn\)[^{]*\{[^}]*padding:\s*0/s)
  assert.match(tourStyles, /driver-popover-arrow\)[^{]*\{[^}]*border-color:\s*var\(--product-tour-popover-bg\)/s)
  assert.match(tourStyles, /driver-popover-arrow-side-left\)[^{]*\{[^}]*filter:\s*drop-shadow\(1px 0 0 var\(--border-strong\)\)[^}]*left:\s*calc\(100% - 1px\)/s)
  assert.match(tourStyles, /driver-popover-arrow-side-right\)[^{]*\{[^}]*filter:\s*drop-shadow\(-1px 0 0 var\(--border-strong\)\)[^}]*right:\s*calc\(100% - 1px\)/s)
  assert.match(tourStyles, /driver-popover-arrow-side-top\)[^{]*\{[^}]*filter:\s*drop-shadow\(0 1px 0 var\(--border-strong\)\)[^}]*top:\s*calc\(100% - 1px\)/s)
  assert.match(tourStyles, /driver-popover-arrow-side-bottom\)[^{]*\{[^}]*bottom:\s*calc\(100% - 1px\)[^}]*filter:\s*drop-shadow\(0 -1px 0 var\(--border-strong\)\)/s)
})
