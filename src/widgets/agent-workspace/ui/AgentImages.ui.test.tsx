import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentToolImageReference } from '#common/contracts'
import { AgentConversation } from './AgentConversation.tsx'
import { AgentMarkdown } from './AgentMarkdown.tsx'
import { AgentAttachmentPreview } from './AgentAttachmentPreview.tsx'
import { AgentToolTimeline } from './AgentToolTimeline.tsx'
import { loadAgentImage, agentMessageImageCatalogs } from '../model/agentImageResources.ts'
import type { AgentWorkspaceImage, AgentWorkspaceMessage } from '../model/types.ts'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, values?: { name?: string }) => values?.name ? `${key}:${values.name}` : key,
    i18n: { resolvedLanguage: 'zh-CN' } }),
}))

const image: AgentWorkspaceImage = { id: 'result:1', reference: agentToolImageReference('capture', 1)!, mime_type: 'image/png',
  size_bytes: 5, session_id: 's', message_id: 'm', part_id: 'p', revision: 1, content_index: 1 }
const load = vi.fn(async () => new Blob(['image'], { type: 'image/png' }))
const createURL = vi.fn(() => 'blob:image')
const revokeURL = vi.fn()
let originalCreateURL: PropertyDescriptor | undefined
let originalRevokeURL: PropertyDescriptor | undefined

beforeEach(() => {
  originalCreateURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  originalRevokeURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  createURL.mockClear()
  revokeURL.mockClear()
  load.mockClear()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeURL })
})

afterEach(() => {
  for (const [name, value] of [['createObjectURL', originalCreateURL], ['revokeObjectURL', originalRevokeURL]] as const) {
    if (value) Object.defineProperty(URL, name, value)
    else Reflect.deleteProperty(URL, name)
  }
})

describe('Agent 图片资源', () => {
  it('按引用加载有限大小的栅格图片，大小、格式不符及取消明确失败', async () => {
    const blob = await loadAgentImage(image, load)
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBe(5)
    await expect(loadAgentImage(image)).rejects.toThrow('AGENT_IMAGE_INVALID')
    await expect(loadAgentImage({ ...image, size_bytes: 8 }, load)).rejects.toThrow('AGENT_IMAGE_INVALID')
    await expect(loadAgentImage({ ...image, mime_type: 'image/jpeg' }, load)).rejects.toThrow('AGENT_IMAGE_INVALID')
    await expect(loadAgentImage({ ...image, mime_type: 'image/svg+xml' }, load)).rejects.toThrow('AGENT_IMAGE_INVALID')
    await expect(loadAgentImage({ ...image, size_bytes: 14 * 1024 * 1024 }, load)).rejects.toThrow('AGENT_IMAGE_INVALID')
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(loadAgentImage(image, load, cancelled.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('工具折叠时不挂载详情或下载图片，展开后完整加载，收起时释放资源', async () => {
    const detail = '完整工具结果\n'.repeat(10000)
    const view = render(<AgentToolTimeline tool={{ id: 'call', kind: 'tool', name: 'capture', status: 'completed', detail, images: [image] }} onLoadToolImage={load} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(view.container.querySelector('pre')).toBeNull()
    expect(load).not.toHaveBeenCalled()
    const details = view.container.querySelector('details')!
    fireEvent.click(view.container.querySelector('summary')!)
    await waitFor(() => expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:image'))
    expect(details).toHaveAttribute('open')
    expect(load).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('pre')?.textContent).toBe(detail)
    fireEvent.click(view.container.querySelector('summary')!)
    await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument())
    expect(revokeURL).toHaveBeenCalled()
    expect(view.container.querySelector('pre')).toBeNull()
    fireEvent.click(view.container.querySelector('summary')!)
    await waitFor(() => expect(view.container.querySelector('pre')?.textContent).toBe(detail))
  })

  it('结论中的图片直接显示并可查看大图，工具图片仍折叠；切换会话关闭预览', async () => {
    const messages = [message('tool', [{ id: 'call', kind: 'tool', name: 'termous.desktops.capture', status: 'completed', images: [image] }]),
      message('answer', [{ id: 'text', kind: 'text', text: `完成。\n\n![最终画面](${image.reference})` }])]
    const view = render(<AgentConversation messages={messages} runStatus="completed" loading={false} sessionKey="one" onLoadToolImage={load} />)
    expect(view.container.querySelector('details')).not.toHaveAttribute('open')
    expect(screen.queryByRole('button', { name: 'agent.attachments.previewName:agent.images.result' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'agent.attachments.previewName:最终画面' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'agent.attachments.previewName:最终画面' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('最终画面')
    expect(within(dialog).getByRole('button', { name: 'imagePreview.actualSize' })).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByAltText('最终画面')).toHaveAttribute('src', 'blob:image'))
    view.rerender(<AgentConversation messages={[message('new', [{ id: 'text', kind: 'text', text: `![失效引用](${image.reference})` }])]} runStatus="completed" loading={false} sessionKey="two" />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('agent.images.unavailable')).toBeVisible()
    expect(revokeURL).toHaveBeenCalled()
  })

  it('资源目录不会被未来消息或其他会话的重复标识改写', () => {
    const replacement = { ...image, id: 'replacement', revision: 2 }
    const catalogs = agentMessageImageCatalogs([
      message('before', []),
      message('first', [{ id: 'call1', kind: 'tool', name: 'capture', status: 'completed', images: [image] }]),
      message('answer', []),
      message('second', [{ id: 'call2', kind: 'tool', name: 'capture', status: 'completed', images: [replacement] }]),
    ])
    expect(catalogs[0]!.images.size).toBe(0)
    expect(catalogs[1]!.images.get(image.reference)).toBe(image)
    expect(catalogs[2]!.images.get(image.reference)).toBe(image)
    expect(catalogs[3]!.images.get(image.reference)).toBe(replacement)
    expect(agentMessageImageCatalogs([message('other-session', [])])[0]!.images.size).toBe(0)
  })

  it('流式回答和资源目录更新时保留图片节点与打开的预览，不重复读取原图', async () => {
    const markdown = `![画面](${image.reference})`
    const view = render(<AgentMarkdown images={new Map([[image.reference, image]])} onLoadToolImage={load}>{markdown}</AgentMarkdown>)
    await waitFor(() => expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:image'))
    const thumbnail = view.container.querySelector('img')
    fireEvent.click(screen.getByRole('button', { name: 'agent.attachments.previewName:画面' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByAltText('画面')).toHaveAttribute('src', 'blob:image'))
    expect(load).toHaveBeenCalledTimes(2)

    view.rerender(<AgentMarkdown images={new Map([[image.reference, { ...image }]])} onLoadToolImage={load}>{`${markdown}\n\n继续输出文字。`}</AgentMarkdown>)
    await act(async () => undefined)
    expect(view.container.querySelector('img')).toBe(thumbnail)
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(load).toHaveBeenCalledTimes(2)
    expect(revokeURL).not.toHaveBeenCalled()
  })

  it('图片包在外链中时只保留预览，不打开外链；任意 URL 仍被阻止', async () => {
    const view = render(<AgentMarkdown images={new Map([[image.reference, image]])} onLoadToolImage={load}>{[
      `[![画面](${image.reference})](https://example.test/track)`,
      '![external](https://example.test/image.png)', '![local](file:///image.png)',
      '![data](data:image/png;base64,eA==)',
    ].join('\n\n')}</AgentMarkdown>)
    expect(view.container.querySelector('a')).toBeNull()
    expect(screen.getAllByText('agent.markdown.remoteImageBlocked')).toHaveLength(3)
    await waitFor(() => expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:image'))
    expect(view.container.querySelectorAll('img')).toHaveLength(1)
  })

  it('本地图片草稿与已发送图片复用带缩放的查看器，关闭时回收 URL', async () => {
    const local = { file: new File(['image'], '草稿.png', { type: 'image/png' }) }
    const load = vi.fn(async () => new Blob(['image'], { type: 'image/png' }))
    const view = render(<AgentAttachmentPreview local={local} onLoad={load} onClose={() => undefined} />)
    await waitFor(() => expect(screen.getByAltText('草稿.png')).toHaveAttribute('src', 'blob:image'))
    expect(load).not.toHaveBeenCalled()
    const attachment = { id: 'a', session_id: 's', kind: 'image' as const, original_name: '发送.png',
      mime_type: 'image/png', size_bytes: 5, state: 'bound' as const, revision: 1, created_at: '', updated_at: '' }
    view.rerender(<AgentAttachmentPreview attachment={attachment} onLoad={load} onClose={() => undefined} />)
    await waitFor(() => expect(screen.getByAltText('发送.png')).toHaveAttribute('src', 'blob:image'))
    expect(screen.getByRole('button', { name: 'imagePreview.zoomIn' })).toBeInTheDocument()
    expect(load).toHaveBeenCalledWith(attachment, expect.any(AbortSignal))
    view.rerender(<AgentAttachmentPreview onLoad={load} onClose={() => undefined} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(revokeURL).toHaveBeenCalledTimes(2)
    await act(async () => undefined)
  })
})

function message(id: string, parts: AgentWorkspaceMessage['parts']): AgentWorkspaceMessage {
  return { id, parts, role: 'assistant', status: 'completed', created_at: '2026-10-13T00:00:00Z', attachments: [] }
}
