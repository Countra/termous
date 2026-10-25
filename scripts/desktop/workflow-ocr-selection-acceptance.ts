import assert from 'node:assert/strict'
import type { BrowserWindow } from 'electron'

interface Harness {
  js: (window: BrowserWindow, script: string) => Promise<unknown>
  click: (window: BrowserWindow, label: string) => Promise<void>
  until: (check: () => boolean | Promise<boolean>, message: string) => Promise<void>
}

export async function checkOCRSelection(window: BrowserWindow, { js, click, until }: Harness) {
  const [width, height] = window.getSize()
  await click(window, '选择文字框 2：Healthy')
  await until(async () => !!await js(window, `document.querySelector('[data-ocr-id="2"]')?.getAttribute('aria-pressed')==='true'`), '画面文字框未选中')
  assert.equal(await js(window, `document.querySelectorAll('[aria-label="OCR 匹配结果"] li')[2]?.querySelector('button')?.getAttribute('aria-pressed')`), 'true', '画面选择未同步到列表')
  await js(window, `document.querySelectorAll('[aria-label="OCR 匹配结果"] button')[1].click()`)
  await until(async () => !!await js(window, `document.querySelector('[data-ocr-id="1"]')?.getAttribute('aria-pressed')==='true'`), '列表选择未同步到画面')
  assert.equal(await js(window, `document.querySelectorAll('[data-ocr-id]').length`), 4, '反复选择不应清空本次结果')
  // 标签切换不销毁截图；选中画面需以约束保证占满空间，不能依赖一次异步 setLayout。
  window.setSize(780, 900)
  await until(async () => !!await js(window, `!!document.querySelector('[data-workflow-editor-layout][data-compact="true"]')`), '窄窗口布局未启用')
  for (const label of ['步骤属性', '画面', '执行链', '画面']) {
    await js(window, `(()=>{const node=[...document.querySelectorAll('.ant-segmented-item')].find(node=>node.textContent==='${label}');if(!node)throw Error('标签不存在');node.click()})()`)
    const panel = label === '画面' ? 'canvas' : label === '步骤属性' ? 'details' : 'chain'
    await until(async () => !!await js(window, `document.getElementById('${panel}')?.getBoundingClientRect().width>300`), `窄窗${label}没有展开`)
  }
  assert.equal(await js(window, `document.querySelector('[data-ocr-id="1"]')?.getAttribute('aria-pressed')`), 'true', '标签切换丢失 OCR 选择')
  window.setSize(width, height)
  await until(async () => !!await js(window, `!document.querySelector('[data-workflow-editor-layout][data-compact="true"]')&&document.getElementById('canvas')?.getBoundingClientRect().width>300`), '宽窗口画面未恢复')
}
