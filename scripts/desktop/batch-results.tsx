import { createRoot } from 'react-dom/client'
import '#shared/styles'
import { changeLanguage } from '#shared/i18n'
import { TermousUiProvider } from '#app/ui-runtime'
import { readDesktopBatch } from '#common/desktop-batch'
import { AgentToolTimeline } from '../../src/widgets/agent-workspace/ui/AgentToolTimeline.tsx'
import type { AgentWorkspaceToolPart } from '../../src/widgets/agent-workspace/model/types.ts'

// 只加载实机验收产物，复用生产工具记录和图片组件，不提供桌面输入或授权入口。
interface Receipt { result: unknown; images: string[]; elapsed_ms: number; tool_error?: boolean }
interface Report { samples: Array<Receipt & { mode: string }>; preflight: Receipt[]; cancellation: { receipt: Receipt }; long_wait?: { receipt: Receipt } }
const blobs = new Map<string, Blob>()
async function load() {
  await changeLanguage('zh-CN')
  const response = await fetch('/batch-evidence/rdp-result.json')
  if (!response.ok) throw new Error('实机回执不可读')
  const report = await response.json() as Report
  const selected = [
    { title: 'win-4090 · 已完成', value: report.samples.filter(sample => sample.mode === 'batch').at(-1)! },
    ...(report.long_wait ? [{ title: 'win-4090 · 35 秒长等待', value: report.long_wait.receipt }] : []),
    { title: 'win-4090 · 全链预检拒绝', value: report.preflight[0]! },
    { title: 'win-4090 · 等待期间取消', value: report.cancellation.receipt },
  ]
  const records = await Promise.all(selected.map(async ({ title, value }, index) => {
    const receipt = readDesktopBatch(value.result)
    if (!receipt) throw new Error('实机回执未通过生产合同校验')
    const images = await Promise.all(value.images.map(async filename => {
      const id = filename.split(/[\\/]/u).at(-1)!
      const image = await fetch(`/batch-evidence/${encodeURIComponent(id)}`)
      if (!image.ok) throw new Error('实机图片不可读')
      const blob = await image.blob()
      blobs.set(id, blob)
      return { id, reference: id, session_id: 'live-verification', message_id: 'receipt', part_id: receipt.id, content_index: 1, revision: 1, mime_type: 'image/png', size_bytes: blob.size }
    }))
    const tool: AgentWorkspaceToolPart = { id: receipt.id, kind: 'tool', name: 'termous.desktops.execute',
      status: receipt.state === 'completed' ? 'completed' : 'failed', duration_ms: value.elapsed_ms, desktop_batch: receipt, images }
    return <article key={tool.id} data-testid={`receipt-${index}`}><h2>{title}</h2><AgentToolTimeline tool={tool} onLoadToolImage={async image => {
      const blob = blobs.get(image.id)
      if (!blob) throw new Error('实机图片不存在')
      return blob
    }} /></article>
  }))
  createRoot(document.getElementById('root')!).render(<TermousUiProvider><main style={{ maxWidth: 1040, margin: '32px auto', padding: 24, color: '#e8eaf0' }}>
    <h1>桌面链式命令 · 实机回执</h1><p>来源：win-4090 RDP。展开生产工具记录可查看逐步状态和原始截图。</p>{records}
  </main></TermousUiProvider>)
}
void load().catch(error => { document.getElementById('root')!.textContent = String(error) })
