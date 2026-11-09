import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { app, BrowserWindow } from 'electron'
import { DetachedWindows } from '../../electron/detached-windows/manager.ts'

const output = path.resolve(process.argv[2])
const label = process.env.TERMOUS_INPUT_SAMPLE ?? 'input'
assert(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(label), '输入验收报告名称仅允许字母、数字、下划线及短横线，最长 80 字符')
const baseURL = process.env.TERMOUS_INPUT_URL ?? 'http://127.0.0.1:5183/'
const rounds = Number(process.env.TERMOUS_INPUT_ROUNDS ?? 24)
assert(Number.isInteger(rounds) && rounds >= 1 && rounds <= 250, '输入验收轮次必须介于 1 和 250')
app.setPath('userData', path.join(output, 'user-data'))
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const js = (window: BrowserWindow, script: string) => window.webContents.executeJavaScript(script)
async function until(check: () => Promise<boolean>, message: string) {
  const deadline = Date.now() + 30000
  while (!await check()) { assert(Date.now() < deadline, message); await wait(50) }
}

async function main() {
  await app.whenReady()
  const host = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: {
    preload: path.join(output, 'host-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
  } })
  const manager = new DetachedWindows({ host: () => host,
    trusted: event => event.sender === host.webContents && event.senderFrame === host.webContents.mainFrame,
    reveal: () => host.show(), renderer: path.join(process.cwd(), 'dist/index.html'), devURL: baseURL,
    preload: path.join(output, 'detached-preload.cjs'), appearance: () => ({ theme: 'dark', language: 'zh-CN' }),
  })
  const samples: unknown[] = []
  try {
    await host.loadURL(`${baseURL}scripts/agent/detached-preview.html?history=long`)
    host.showInactive()
    await until(() => js(host, '!!document.querySelector("[data-agent-session-id=session-one] button:not([aria-label])")'), '历史会话未加载')
    await js(host, 'document.querySelector("[data-agent-session-id=session-one] button:not([aria-label])").click()')
    await until(() => js(host, '!!document.querySelector("[data-agent-message]")'), '历史正文未就绪')
    await js(host, 'document.querySelector("button[aria-label=在独立窗口打开]").click()')
    await until(async () => BrowserWindow.getAllWindows().some(window => window !== host && window.isVisible()), '小窗未就绪')
    const detached = BrowserWindow.getAllWindows().find(window => window !== host)!
    await until(() => js(detached, '!!document.querySelector("textarea") && !document.querySelector("textarea").closest("[inert]")'), '小窗未取得编辑权')
    // 快照与正文可能分批到达；未加载目标负载的采样不能作为长历史性能验收。
    await until(() => js(detached, `document.querySelectorAll('[data-agent-session-id]').length === 80
      && document.querySelectorAll('[data-agent-part]').length === 200`), '长历史验收负载未完整加载')
    host.hide()
    detached.focus()
    await js(detached, `(() => {
      window.inputSamples = []; window.inputLongTasks = [];
      new PerformanceObserver(list => { for (const item of list.getEntries()) window.inputLongTasks.push(item.duration); }).observe({ type: 'longtask' });
      document.querySelector('textarea').addEventListener('input', () => {
        const start = performance.now(); requestAnimationFrame(() => window.inputSamples.push(performance.now() - start));
      });
      document.querySelector('textarea').focus();
    })()`)
    detached.webContents.debugger.attach('1.3')
    const record = async (phase: string) => {
      const metrics = app.getAppMetrics().filter(item => item.type === 'Tab').map(item => ({
        pid: item.pid, role: item.pid === host.webContents.getOSProcessId() ? 'host' : 'detached',
        privateMiB: item.memory.privateBytes === undefined ? undefined : item.memory.privateBytes / 1024,
      }))
      const ui = await js(detached, `({ inputs: window.inputSamples.length, nodes: document.querySelectorAll('*').length,
        messages: document.querySelectorAll('[data-agent-message]').length, parts: document.querySelectorAll('[data-agent-part]').length })`)
      samples.push({ phase, metrics, ...ui })
    }
    await wait(500)
    await record('loaded')
    const started = Date.now()
    // 原生文本输入覆盖每个字符的受控回显及宿主确认，不用一次性替换整个草稿模拟打字。
    const text = '请检查独立窗口输入响应，保留每个字符。ABC123 '
    const expected = text.repeat(rounds)
    for (let i = 0; i < expected.length; i++) {
      await detached.webContents.debugger.sendCommand('Input.insertText', { text: expected[i] })
      await wait(8)
      if ((i + 1) % 200 === 0) await record(`typed-${i + 1}`)
    }
    await wait(500)
    assert.equal(await js(detached, 'document.querySelector("textarea").value'), expected, '小窗输入丢字')
    await record('typed')
    const result = await js(detached, `({ latency: window.inputSamples, longTasks: window.inputLongTasks })`) as { latency: number[]; longTasks: number[] }
    const latency = [...result.latency].sort((a, b) => a - b)
    assert.equal(latency.length, expected.length, '输入事件采样不完整')
    const report = { label, electron: process.versions.electron, elapsedMs: Date.now() - started,
      characters: expected.length, p50: latency[Math.floor(latency.length * .5)], p95: latency[Math.floor(latency.length * .95)],
      max: latency[latency.length - 1], ...result, samples }
    await writeFile(path.join(output, `${label}.png`), (await detached.webContents.capturePage()).toPNG())
    detached.close()
    await until(async () => detached.isDestroyed(), '草稿交接未完成')
    assert.equal(await js(host, 'document.querySelector("textarea").value'), expected, '收回窗口后草稿不一致')
    await writeFile(path.join(output, `${label}.json`), JSON.stringify({ ...report, handoff: 'passed' }, null, 2))
    console.log(JSON.stringify({ label, inputs: latency.length, p95: latency[Math.floor(latency.length * .95)], max: latency[latency.length - 1], longTasks: result.longTasks.length, handoff: 'passed' }))
  } finally { manager.close(); host.destroy() }
}

void main().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
