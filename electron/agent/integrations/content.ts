import type { CallToolResult } from '@earendil-works/pi-mcp'
import type { IntegrationCorePort, IntegrationRunContext } from '../contracts/integrations.ts'
import type { IntegrationToolResult } from '#common/agent-integrations'
import { resourceImage } from '../contracts/runtimeResourceImages.ts'

// 只有宿主生成的资源引用进入 Worker；远端 _meta 与原始 Base64 不穿过 IPC。
export async function normalizeIntegrationResult(core: IntegrationCorePort, context: IntegrationRunContext, call: string,
  result: CallToolResult, signal?: AbortSignal): Promise<IntegrationToolResult> {
  const content: IntegrationToolResult['content'] = []
  let textBytes = 0
  let imageIndex = 0
  const store = async (data: string, mime: string, name?: string) => {
    const reference = await core.stageContent(context, call, data, mime, signal)
    content.push({ type: 'text', text: JSON.stringify({ resource: reference, ...(name ? { name } : {}), read_with: 'read_integration_resource' }) })
  }
  const text = async (value: string, mime = 'text/plain') => {
    const bytes = Buffer.byteLength(value)
    if (bytes <= 32 * 1024 && textBytes + bytes <= 64 * 1024) { content.push({ type: 'text', text: value }); textBytes += bytes }
    else await store(Buffer.from(value).toString('base64'), mime)
  }
  if (!Array.isArray(result.content) || result.content.length > 1024) throw new Error('INTEGRATION_RESULT_INVALID')
  for (const block of result.content) {
    signal?.throwIfAborted()
    switch (block.type) {
      case 'text': await text(block.text); break
      case 'image': content.push(resourceImage(await core.stageImage(context, call, imageIndex++, block.data, block.mimeType, signal))); break
      case 'audio': await store(block.data, block.mimeType, 'Audio'); break
      case 'resource_link': await text(JSON.stringify({ type: 'resource_link', uri: block.uri, name: block.name, description: block.description, mime_type: block.mimeType })); break
      case 'resource':
        if ('text' in block.resource) await text(block.resource.text, block.resource.mimeType ?? 'text/plain')
        else await store(block.resource.blob, block.resource.mimeType ?? 'application/octet-stream', block.resource.uri)
        break
      default: throw new Error('INTEGRATION_CONTENT_UNSUPPORTED')
    }
  }
  if (result.structuredContent !== undefined) await text(JSON.stringify({ structuredContent: result.structuredContent }), 'application/json')
  if (!content.length) content.push({ type: 'text', text: '(No content returned.)' })
  if (Buffer.byteLength(JSON.stringify(content)) > 240 * 1024) throw new Error('INTEGRATION_RESULT_TOO_LARGE')
  return { content, isError: result.isError === true, operation: call }
}
