import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '#entities/agent'
import { projectAgentMessages } from './agentWorkspaceProjection.ts'

describe('工具图片消息投影', () => {
  it('历史结果按原始索引关联图片，详情不保留二进制正文，原消息保持不变', () => {
    const metadata = { message_id: 'm', revision: 1, created_at: '', updated_at: '' }
    const message: AgentMessage = {
      id: 'm', session_id: 's', role: 'assistant', status: 'completed', revision: 1, sequence: 1,
      created_at: '', updated_at: '', attachments: [], parts: [
        { ...metadata, id: 'call', sequence: 1, kind: 'tool_call', tool_call: {
          tool_call_id: 'capture', tool_name: 'termous.desktops.capture', arguments: {},
        } },
        { ...metadata, id: 'result', sequence: 2, kind: 'tool_result', tool_result: {
          tool_call_id: 'capture', tool_name: 'termous.desktops.capture', is_error: false,
          images: [{ content_index: 1, mime_type: 'image/png', size_bytes: 34567 },
            { content_index: 3, mime_type: 'image/jpeg', size_bytes: 23456 }],
          content: [{ type: 'text', text: '尺寸 1920 × 1080' },
            { type: 'image', data: 'private-image-body', mimeType: 'image/png' },
            { type: 'image', data: 'unsafe-svg', mimeType: 'image/svg+xml' },
            { type: 'image', data: 'second-image', mimeType: 'image/jpeg' },
            { type: 'audio', data: 'private-audio', mimeType: 'audio/wav' }],
        } },
      ],
    }
    const original = structuredClone(message)
    const tool = projectAgentMessages([message], undefined, [])[0]!.parts[0]!
    expect(tool.kind).toBe('tool')
    if (tool.kind !== 'tool') throw new Error('missing tool')
    expect(tool.images).toEqual([
      { id: 's:m:result:1:1', reference: 'termous-image://tool/capture/1', mime_type: 'image/png', size_bytes: 34567,
        session_id: 's', message_id: 'm', part_id: 'result', revision: 1, content_index: 1 },
      { id: 's:m:result:1:3', reference: 'termous-image://tool/capture/3', mime_type: 'image/jpeg', size_bytes: 23456,
        session_id: 's', message_id: 'm', part_id: 'result', revision: 1, content_index: 3 },
    ])
    expect(tool.detail).toContain('尺寸 1920 × 1080')
    expect(tool.detail).toContain('二进制内容已省略')
    expect(tool.detail).not.toMatch(/private-image-body|unsafe-svg|second-image|private-audio/)
    expect(message).toEqual(original)
  })
})
