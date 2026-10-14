import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import type { RuntimeContextImageReference } from '../contracts/runtimeCheckpoint.ts'

export function createHistoryImageTool(read: (ref: RuntimeContextImageReference, signal?: AbortSignal) => Promise<{ data: string; mime_type: string }>): AgentTool {
  return {
    name: 'read_history_image', label: '重读历史图片', executionMode: 'sequential',
    description: '按当前会话的持久化 history_image 引用读取图片。只恢复像素，不延长截图或桌面输入授权。',
    parameters: Type.Object({ reference: Type.Object({
      type: Type.Literal('image_ref'), mime_type: Type.String(), sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
      attachment_id: Type.Optional(Type.String()), message_part_id: Type.Optional(Type.String()), content_index: Type.Optional(Type.Integer({ minimum: 0 })),
    }, { additionalProperties: false }) }, { additionalProperties: false }),
    execute: async (_id, input, signal) => {
      const result = await read((input as { reference: RuntimeContextImageReference }).reference, signal)
      return { content: [{ type: 'text', text: '以下为已保存的历史图片，不能据此判断远端当前状态。' }, { type: 'image', data: result.data, mimeType: result.mime_type }], details: { kind: 'history_image' } }
    },
  }
}
