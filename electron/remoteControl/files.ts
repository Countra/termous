import { dialog, type BrowserWindow } from 'electron'
import { fromJson, toJson } from '@bufbuild/protobuf'
import { FileLocationSchema } from '@termous/remote-protocol'
import type { RemoteLocalSelection, RemoteLocalTask } from '#common/contracts'
import { RemoteCore, RemoteCoreError, validId } from './core'

// 文件选择及授权完全留在主进程，Renderer 无法提交本机路径。
export class RemoteLocalTransfers {
  private selecting = false
  constructor(private core: RemoteCore, private warn: (code: string) => void) {}

  async select(window: BrowserWindow, base: string, generation: string, input: RemoteLocalSelection): Promise<RemoteLocalTask | null> {
    if (this.selecting) throw new RemoteCoreError('remote_transfer_busy')
    if (!input || !['upload', 'download'].includes(input.direction) || !['rename', 'skip', 'replace'].includes(input.overwrite) || JSON.stringify(input).length > 256 * 1024) throw new RemoteCoreError('remote_invalid_request')
    const location = fromJson(FileLocationSchema, input.location)
    if (location.kind !== 'files' || !validId(location.resourceId) || location.generation === 0n || !location.path || location.path.length > 4096) throw new RemoteCoreError('remote_invalid_request')
    if (input.direction === 'download' && (typeof input.name !== 'string' || !input.name || input.name.length > 255 || ['.', '..'].includes(input.name) || /[/\\:\0]/.test(input.name))) throw new RemoteCoreError('remote_invalid_request')
    if (input.locations && (!Array.isArray(input.locations) || input.locations.length > 128)) throw new RemoteCoreError('remote_invalid_request')
    const locations = input.locations?.map(value => fromJson(FileLocationSchema, value))
    if (locations?.some(value => value.kind !== location.kind || value.resourceId !== location.resourceId || value.generation !== location.generation || !value.path || value.path.length > 4096)) throw new RemoteCoreError('remote_invalid_request')
    this.selecting = true
    let grant: string | undefined
    try {
      const selected = await dialog.showOpenDialog(window, { properties: input.direction === 'upload' ? [input.directory ? 'openDirectory' : 'openFile', 'multiSelections'] : ['openDirectory'] })
      if (selected.canceled || !selected.filePaths[0]) return null
      if (window.isDestroyed()) throw new RemoteCoreError('remote_disconnected')
      let directory: string | undefined
      if (input.direction === 'upload') {
        if (selected.filePaths.length > 128) throw new RemoteCoreError('remote_file_selection_invalid')
        const value = await this.core.request<{ id: string }>('/local-file-grants', { source: 'picker', paths: selected.filePaths })
        if (!validId(value.id)) throw new RemoteCoreError('remote_file_selection_invalid')
        grant = value.id
      } else directory = selected.filePaths[0]
      return await this.core.request<RemoteLocalTask>(`${base}/local-transfers`, { generation, direction: input.direction, grant_id: grant, directory, name: input.name, location: toJson(FileLocationSchema, location), locations: locations?.map(value => toJson(FileLocationSchema, value)), overwrite: input.overwrite })
    } finally {
      this.selecting = false
      // 成功消费的授权已被 Go 移除；未消费的授权也及时释放。
      if (grant) {
        try { await this.core.request(`/local-file-grants/${encodeURIComponent(grant)}`, undefined, 'DELETE') }
        catch { this.warn('remote_file_grant_release_failed') }
      }
    }
  }
}
