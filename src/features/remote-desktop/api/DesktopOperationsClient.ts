import type { DesktopControl, DesktopInput, DesktopScreenshotRequest, DesktopSnapshotMetadata, DesktopState } from '#entities/remote-desktop'
import { TermousApiError, TermousApiTransport } from '#shared/api'

export interface DesktopLeaseRequest {
  expected_connection_generation: number
  lease_id: string
  control_generation: number
}

// 公共桌面操作只走已有本机认证；此客户端不推导身份，也不重试有副作用的请求。
export class DesktopOperationsClient extends TermousApiTransport {
  describe(id: string, generation: number, signal?: AbortSignal) {
    return this.request<DesktopState>(`${this.path(id)}/desktop?generation=${generation}`, { signal })
  }

  async capture(id: string, request: DesktopScreenshotRequest, signal?: AbortSignal) {
    let metadata: DesktopSnapshotMetadata | undefined
    const png = await this.requestBlob(`${this.path(id)}/screenshots`, {
      method: 'POST', body: request, signal, timeoutMs: 12_000,
      onHeaders(headers) {
        const raw = headers.get('X-Termous-Desktop-Snapshot')
        if (!raw) throw new TermousApiError('截图缺少元数据', 'desktop_invalid_response', 0)
        metadata = JSON.parse(raw) as DesktopSnapshotMetadata
      },
    })
    if (!metadata || !metadata.width || !metadata.height || metadata.connection_generation !== request.expected_connection_generation || png.type !== 'image/png') {
      throw new TermousApiError('截图响应无效', 'desktop_invalid_response', 0)
    }
    return { metadata, png }
  }

  acquire(id: string, generation: number, takeover = false, signal?: AbortSignal) {
    return this.request<DesktopControl>(`${this.path(id)}/control-leases`, {
      method: 'POST', body: { expected_connection_generation: generation, takeover }, signal,
    })
  }

  renew(id: string, lease: DesktopLeaseRequest, signal?: AbortSignal) {
    return this.request<DesktopControl>(`${this.path(id)}/control-leases/renew`, { method: 'POST', body: lease, signal })
  }

  release(id: string, lease: DesktopLeaseRequest, signal?: AbortSignal) {
    return this.request<void>(`${this.path(id)}/control-leases/release`, { method: 'POST', body: lease, signal })
  }

  async input(id: string, input: DesktopInput, signal?: AbortSignal) {
    if (signal?.aborted) throw new TermousApiError('请求已取消', 'REQUEST_ABORTED', 0)
    try {
      await this.request<void>(`${this.path(id)}/input`, { method: 'POST', body: input, signal })
    } catch (error) {
      // 请求已经进入网络层，断网或取消不能证明目标尚未执行。
      if (error instanceof TermousApiError && error.status === 0) throw new TermousApiError('输入执行结果不确定', 'desktop_input_uncertain', 0)
      throw error
    }
  }

  private path(id: string) { return `/api/v1/remote-desktop-sessions/${encodeURIComponent(id)}` }
}
