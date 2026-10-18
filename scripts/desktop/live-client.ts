import { create, fromJson, toJson } from '@bufbuild/protobuf'
import { ResponseSchema } from '@termous/remote-protocol'
import { DesktopRequestSchema, type DesktopAttachment } from '@termous/remote-protocol/desktop-protocol'
import type { RemoteClient } from '#entities/remote-control'

// 仅供显式启动的本机联调页面使用，不输出凭据、票据或输入正文。
export const liveAPI = async (path: string, body?: unknown) => {
  const response = await fetch(`/fixture/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Termous-Fixture': 'desktop', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!response.ok) throw new Error(`live_http_${response.status}`)
  return response.status === 204 ? null : response.json()
}

let attachment: DesktopAttachment | undefined
export const liveClient = {
  desktop: async (input: Parameters<RemoteClient['desktop']>[0]) => {
    const response = fromJson(ResponseSchema, await liveAPI('request', toJson(DesktopRequestSchema, create(DesktopRequestSchema, input))))
    if (response.error) throw new Error(response.error.code)
    if (response.result.case !== 'desktop') throw new Error('invalid_live_response')
    if (response.result.value.attachment) attachment = response.result.value.attachment
    return response.result.value
  },
  desktopICE: async () => [],
} as unknown as RemoteClient

export async function captureLiveDesktop() {
  const a = attachment
  if (!a) throw new Error('live_attachment_unavailable')
  const request = (input: Parameters<RemoteClient['desktop']>[0]) => liveClient.desktop({ sessionId: a.sessionId, connectionGeneration: a.connectionGeneration, attachmentId: a.id, mediaGeneration: a.mediaGeneration, ...input })
  const { image } = await request({ action: 'capture', capture: { maxWidth: 1280, maxHeight: 720 } })
  if (!image || image.totalBytes === 0 || image.totalBytes > 32 * 1024 * 1024) throw new Error('live_capture_invalid')
  const pixels = new Uint8Array(image.totalBytes)
  let chunks = 0
  for (let offset = 0; offset < pixels.length;) {
    const part = (await request({ action: 'image', captureId: image.id, offset })).image
    if (!part || part.offset !== offset || !part.data.length || offset + part.data.length > pixels.length) throw new Error('live_capture_chunk_invalid')
    pixels.set(part.data, offset); offset += part.data.length; chunks++
  }
  const bitmap = await createImageBitmap(new Blob([pixels], { type: 'image/png' }))
  const result = { width: bitmap.width, height: bitmap.height, bytes: pixels.length, chunks, frame: String(image.frameSequence), display: String(image.displayEpoch) }
  bitmap.close()
  return result
}
