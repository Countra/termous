import assert from 'node:assert/strict'
import type { BrowserWindow } from 'electron'

interface Harness {
  js: (window: BrowserWindow, script: string) => Promise<unknown>
  click: (window: BrowserWindow, label: string) => Promise<void>
  until: (check: () => boolean | Promise<boolean>, message: string) => Promise<void>
}

export async function checkAnalysisLayout(window: BrowserWindow, { js, click, until }: Harness) {
  const width = async () => await js(window, `document.querySelector('[data-analysis-layout] #analysis-sidebar').getBoundingClientRect().width`) as number
  await js(window, `window.analysisCanvas=document.querySelector('img[alt="分析原图"]')`)
  for (const kind of ['历史', '结果']) {
    await click(window, `展开${kind}`)
    await until(async () => (await width()) > 200, '右侧面板未展开')
    assert.equal(await js(window, `document.querySelectorAll('[data-analysis-layout] [role="tabpanel"]').length`), 1, '历史和结果不应同时占据面板')
    const original = await width()
    const point = await js(window, `(()=>{const r=document.querySelector('[role="separator"][aria-label="调整${kind}栏宽度"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`) as { x: number; y: number }
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
    window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x - 40, y: point.y, modifiers: ['leftbuttondown'] })
    window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x - 40, y: point.y, button: 'left', clickCount: 1 })
    await until(async () => (await width()) > original + 20, `调整${kind}栏宽度拖动无效`)
    const expanded = await width()
    await click(window, `收起${kind}`)
    await until(async () => (await width()) < 1, '分析折叠仍占据内容空间')
    await click(window, `展开${kind}`)
    await until(async () => Math.abs(await width() - expanded) < 1, '分析展开未恢复宽度')
  }
  assert(await js(window, `window.analysisCanvas===document.querySelector('img[alt="分析原图"]')`), '分析切换重新加载了原图')
  await click(window, '筛选')
  assert(await js(window, `!!document.querySelector('input[aria-label="最低检测置信度"]')`), '最低置信度筛选未显示')
  await click(window, '筛选')
  const row = await js(window, `(()=>{const list=document.querySelector('[data-analysis-layout] [role="list"]');window.analysisResultList=list;return list.querySelector('button[aria-pressed]').textContent.trim()})()`) as string
  await click(window, row)
  assert(!await js(window, `Array.from(document.querySelectorAll('button')).some(n=>n.textContent==='返回结果')`), '单击结果不应进入详情')
  const details = await js(window, `document.querySelector('[data-analysis-layout] [role="listitem"] button[aria-label]').getAttribute('aria-label')`) as string
  await click(window, details)
  await until(async () => !!await js(window, `Array.from(document.querySelectorAll('button')).some(n=>n.textContent==='返回结果')`), '选中结果未打开详情')
  assert(!await js(window, `Array.from(document.querySelectorAll('[role="dialog"] button')).some(n=>n.textContent==='关闭')`), '分析仍保留底部关闭栏')
  await click(window, '返回结果')
  assert(await js(window, `window.analysisResultList===document.querySelector('[data-analysis-layout] [role="list"]')`), '返回详情重建了结果列表')
  const [windowWidth, windowHeight] = window.getSize()
  window.setSize(780, 900)
  await until(async () => !!await js(window, `document.querySelector('[data-analysis-layout][data-compact="true"]')`), '分析窄窗布局未启用')
  await click(window, '收起结果')
  await until(async () => !!await js(window, `document.getElementById('analysis-canvas')?.getBoundingClientRect().width>300`), '窄窗首次返回画布失败')
  for (const kind of ['结果', '历史', '结果']) {
    await click(window, `展开${kind}`)
    await until(async () => (await width()) > 300, `窄窗${kind}未展开`)
    await click(window, `收起${kind}`)
    await until(async () => !!await js(window, `document.getElementById('analysis-canvas')?.getBoundingClientRect().width>300`), '窄窗收起侧栏后画布未恢复')
    assert((await width()) < 1, '窄窗收起侧栏后仍占宽度')
  }
  window.setSize(windowWidth, windowHeight)
  await click(window, '展开结果')
  await until(async () => (await width()) > 200, '宽窗结果栏未恢复')
}
