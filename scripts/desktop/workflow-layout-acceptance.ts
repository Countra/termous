import assert from 'node:assert/strict'
import type { BrowserWindow } from 'electron'

interface Harness {
  js: (window: BrowserWindow, script: string) => Promise<unknown>
  click: (window: BrowserWindow, label: string) => Promise<void>
  until: (check: () => boolean | Promise<boolean>, message: string) => Promise<void>
}

export async function checkWorkflowLayout(window: BrowserWindow, harness: Harness) {
  const { js, click, until } = harness
  window.focus()
  const widths = async () => await js(window, `['chain','details'].map(id=>document.getElementById(id)?.getBoundingClientRect().width)`) as number[]
  await until(async () => (await widths()).every(n => n > 200), '宽窗口分栏未展开')
  // 偏好已持久化；每轮先通过现有重置交互建立基线，避免反复验收累计增加面板宽度。
  for (const [index, label, expected] of [[0, '调整执行链宽度', 268], [1, '调整步骤详情宽度', 300]] as const) {
    await js(window, `document.querySelector('[role="separator"][aria-label="${label}"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`)
    await until(async () => Math.abs((await widths())[index] - expected) < 1, `${label}未恢复默认宽度`)
  }
  // 用同一 DOM 节点验证切换布局不会重新挂载截图编辑器。
  await js(window, `window.layoutCanvas=document.querySelector('section[aria-label="画面编排"]')`)
  for (const [label, delta] of [['调整执行链宽度', 40], ['调整步骤详情宽度', -50]] as const) {
    const point = await js(window, `(()=>{const r=document.querySelector('[role="separator"][aria-label="${label}"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`) as { x: number; y: number }
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
    window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x + delta, y: point.y, modifiers: ['leftbuttondown'] })
    window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x + delta, y: point.y, button: 'left', clickCount: 1 })
    await until(async () => (await widths())[delta > 0 ? 0 : 1] > (delta > 0 ? 300 : 330), `${label}未响应拖动`)
  }
  await until(async () => { const [left, right] = await widths(); return left > 300 && right > 330 }, '真实拖动未调整两侧宽度')
  const expanded = await widths()
  await click(window, '收起执行链')
  await click(window, '收起步骤属性')
  await until(async () => (await widths()).every(n => Math.abs(n) < 1), '折叠没有完全释放画面空间')
  await click(window, '执行链')
  await click(window, '步骤属性')
  await until(async () => (await widths()).every((n, i) => Math.abs(n - expanded[i]) < 1), '展开未恢复拖动后的宽度')
  assert(await js(window, `window.layoutCanvas===document.querySelector('section[aria-label="画面编排"]')`), '折叠时重新挂载了截图编辑器')
  return expanded
}

export async function checkTransferredLayout(window: BrowserWindow, expected: number[], { js, until }: Harness) {
  let actual: number[] = []
  try {
    await until(async () => {
      actual = await js(window, `['chain','details'].map(id=>document.getElementById(id)?.getBoundingClientRect().width)`) as number[]
      return actual.every((n, i) => Math.abs(n - expected[i]) < 1)
    }, '窗口交接未恢复分栏宽度')
  } catch (cause) {
    if (cause instanceof Error) cause.message += `；分栏宽度预期 ${expected.join(', ')}，实际 ${actual.join(', ')}`
    throw cause
  }
}
