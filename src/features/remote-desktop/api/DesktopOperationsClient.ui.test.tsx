import { afterEach, expect, test, vi } from 'vitest'
import { DesktopOperationsClient } from './DesktopOperationsClient.ts'

afterEach(() => vi.unstubAllGlobals())

test('截图使用认证 POST 并读取 PNG 元数据，输入网络错误不会重试', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(new Blob(['png'], { type: 'image/png' }), {
    headers: { 'Content-Type': 'image/png', 'X-Termous-Desktop-Snapshot': JSON.stringify({ width: 800, height: 600, connection_generation: 1 }) },
  })).mockRejectedValueOnce(new TypeError('offline'))
  vi.stubGlobal('fetch', fetcher)
  const client = new DesktopOperationsClient({ apiBaseUrl: 'http://127.0.0.1:8122', apiToken: 'test-token' })
  const request = { expected_connection_generation: 1, display_epoch: 1, after_sequence: 0, max_width: 0, max_height: 0 }
  const shot = await client.capture('test', request)
  expect(shot.metadata.width).toBe(800)
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify(request), headers: { 'X-Termous-Token': 'test-token' } })
  await expect(client.input('test', { expected_connection_generation: 1, lease_id: 'lease', control_generation: 1, sequence: 1, display_epoch: 1, operation: { kind: 'move', x: 10, y: 10 } })).rejects.toMatchObject({ code: 'desktop_input_uncertain' })
  expect(fetcher).toHaveBeenCalledTimes(2)
})
