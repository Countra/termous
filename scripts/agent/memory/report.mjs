import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'

// 离线汇总只保留数值采样，不将完整事件、消息或图片加载到报告进程。
const root = path.resolve(import.meta.dirname, '../../../../TEMP/agent-memory-research')
const labels = process.argv.slice(2)
if (!labels.length || labels.some(label => !/^[a-z0-9-]+$/u.test(label))) throw new Error('请传入合法验收目录名')
const reports = []
for (const label of labels) {
  const result = JSON.parse(await readFile(path.join(root, label, 'result.json'), 'utf8'))
  const points = []
  let started
  for await (const line of createInterface({ input: createReadStream(path.join(root, label, 'samples.jsonl')), crlfDelay: Infinity })) {
    const row = JSON.parse(line)
    if (row.type !== 'host_memory') continue
    started ??= Date.parse(row.at)
    const sum = predicate => row.processes.filter(predicate).reduce((value, process) => value + process.memory.privateBytes / 1024, 0)
    const core = row.core.private_bytes === undefined ? null : row.core.private_bytes / 1048576
    points.push({ seconds: (Date.parse(row.at) - started) / 1000,
      renderer: sum(process => process.type === 'Tab'), workers: sum(process => process.name === 'Termous Memory Acceptance Worker'),
      electron: sum(() => true), core, total: core === null ? null : sum(() => true) + core,
      worker_count: row.processes.filter(process => process.name === 'Termous Memory Acceptance Worker').length,
      core_heap: row.core.heap_alloc / 1048576 })
  }
  if (!points.length) throw new Error(`${label} 缺少有效采样`)
  const active = points.filter(point => point.worker_count > 0)
  const latter = active.slice(Math.floor(active.length / 2))
  const metrics = {}
  for (const key of ['renderer', 'workers', 'electron', 'core', 'total', 'core_heap']) {
    const values = points.map(point => point[key]).filter(value => value !== null)
    const stable = latter.map(point => point[key]).filter(value => value !== null)
    metrics[key] = !values.length ? null : { peak_mib: Math.max(...values), last_mib: values.at(-1),
      latter_active_mean_mib: stable.length ? stable.reduce((a, b) => a + b, 0) / stable.length : null }
  }
  reports.push({ label, result, sample_count: points.length, metrics, points })
}
await writeFile(path.join(root, 'measurements.json'), JSON.stringify(reports, null, 2))
const colors = ['#dc524b', '#1a8a7b', '#3b73c5', '#b17726']
let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="820" viewBox="0 0 1120 820"><rect width="1120" height="820" fill="#fafafa"/><g font-family="sans-serif" fill="#22303b">'
svg += '<text x="60" y="32" font-size="22">Agent memory — measured private bytes (MiB)</text>'
svg += '<text x="60" y="58" font-size="13">Local model/tool fixtures; no forced GC. Test host is not the full production main process.</text>'
for (const [index, key] of ['renderer', 'total'].entries()) {
  const top = 100 + index * 350
  const available = reports.filter(report => report.points.some(point => point[key] !== null))
  const maxTime = Math.max(...available.flatMap(report => report.points.map(point => point.seconds)))
  const maximum = Math.ceil(Math.max(2048, ...available.flatMap(report => report.points.map(point => point[key] ?? 0))) / 512) * 512
  svg += `<text x="60" y="${top - 12}" font-size="16">${key === 'renderer' ? 'Renderer' : 'Electron + Core (only samples with Core private bytes)'}</text>`
  for (let tick = 0; tick <= 4; tick++) {
    const y = top + 240 - tick * 60
    svg += `<path d="M70 ${y}H1060" stroke="#dce1e4"/><text x="12" y="${y + 5}" font-size="12">${Math.round(maximum * tick / 4)}</text>`
  }
  if (key === 'total') {
    const y = top + 240 - 2048 / maximum * 240
    svg += `<path d="M70 ${y}H1060" stroke="#667788" stroke-dasharray="5 5"/><text x="970" y="${y - 6}" font-size="12">2 GiB target</text>`
  }
  for (const report of available) {
    const color = colors[reports.indexOf(report) % colors.length]
    const coordinates = report.points.filter(point => point[key] !== null).map(point => `${70 + point.seconds / maxTime * 990},${top + 240 - point[key] / maximum * 240}`).join(' ')
    svg += `<polyline points="${coordinates}" stroke="${color}" fill="none" stroke-width="2"/>`
  }
  svg += `<text x="70" y="${top + 260}" font-size="12">0 seconds</text><text x="1000" y="${top + 260}" font-size="12">${Math.round(maxTime)} s</text>`
}
reports.forEach((report, index) => { svg += `<text x="60" y="${740 + index * 18}" font-size="12" fill="${colors[index % colors.length]}">${report.label}</text>` })
svg += '</g></svg>'
await writeFile(path.join(root, 'memory-curves.svg'), svg)
console.log(JSON.stringify(reports.map(({ label, result, metrics }) => ({ label, result, metrics })), null, 2))
