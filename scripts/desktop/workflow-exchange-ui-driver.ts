import assert from 'node:assert/strict'
import type { BrowserWindow } from 'electron'

export const js = (window: BrowserWindow, script: string) => window.webContents.executeJavaScript(script)
export async function until(check: () => boolean | Promise<boolean>, message: string) {
  const deadline = Date.now() + 30000
  while (!await check()) { assert(Date.now() < deadline, message); await new Promise(resolve => setTimeout(resolve, 50)) }
}
export async function click(window: BrowserWindow, label: string, selector = 'button,[role="menuitem"]') {
  const value = JSON.stringify(label)
  await until(() => js(window, `(()=>{const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.getBoundingClientRect().width>0&&(node.getAttribute('aria-label')===${value}||node.textContent.replace(/\\s/g,'')===${value}.replace(/\\s/g,'')));if(!node||node.disabled||node.getAttribute('aria-disabled')==='true')return false;node.click();return true})()`), `按钮不可用：${label}`)
}
export async function exchangeClosed(window: BrowserWindow) {
  await until(() => js(window, `![...document.querySelectorAll('[role="dialog"]')].some(node=>node.getBoundingClientRect().width>0&&node.textContent.includes('工作流文件交换'))`), '文件交换弹层未关闭')
}
export async function importWorkflow(window: BrowserWindow, images = false) {
  await click(window, '导入工作流')
  await until(() => js(window, `!![...document.querySelectorAll('button')].find(node=>node.textContent==='确认新建'&&!node.disabled)`), '导入没有显示冻结预览')
  if (images) await until(() => js(window, `!!document.querySelector('img[alt="模板图片"]')?.naturalWidth`), '模板图片未经过预览媒体通道显示')
  await click(window, '确认新建')
  await until(() => js(window, `document.body.textContent.includes('已导入「')`), '导入没有提交成功')
  await click(window, '关闭'); await exchangeClosed(window)
}
export async function exportWorkflow(window: BrowserWindow, layout: 'zip' | 'json' | 'directory', history = false) {
  if (!history) { await click(window, '更多操作'); await click(window, '导出工作流', '[role="menuitem"]') }
  await until(() => js(window, `!!document.querySelector('input[type="radio"][value=${JSON.stringify(layout)}]')`), '导出格式弹层未显示')
  await js(window, `document.querySelector('input[type="radio"][value=${JSON.stringify(layout)}]').click()`)
  await click(window, '导出工作流', '[role="dialog"] .ant-modal-footer button')
  await until(() => js(window, `document.body.textContent.includes('已导出：')`), '导出没有保存成功')
  await click(window, '关闭'); await exchangeClosed(window)
}
