import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeGatewaysFromConfig } from '#app/data-runtime'
import { InvalidRemotePosixPathError } from '#shared/path'

const API_BASE_URL = 'http://127.0.0.1:8122'

function createFilesGateway() {
  return createRuntimeGatewaysFromConfig({
    apiBaseUrl: API_BASE_URL,
    apiToken: 'test-token',
    version: '1.0.0-test',
  }).files
}

function operationTask(path: string) {
  return {
    id: 'fop-test',
    revision: 1,
    file_session_id: 'file-session-test',
    engine: 'sftp',
    type: 'read_text',
    status: 'running',
    phase: 'read',
    path,
    total_bytes: 0,
    transferred_bytes: 0,
    remaining_bytes: 0,
    phase_total_bytes: 0,
    phase_transferred_bytes: 0,
    phase_progress_percent: 0,
    progress_percent: 0,
    speed_bytes_per_sec: 0,
    average_speed_bytes_per_sec: 0,
    elapsed_seconds: 0,
    cancellable: true,
    created_at: '2026-09-14T00:00:00Z',
  }
}

describe('文件操作 API 虚拟路径合同', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('接受规范任务路径并拒绝服务端返回的非规范路径', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(operationTask('/srv/example.txt')), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(operationTask('/srv/../etc/passwd')), { status: 200 })))
    const files = createFilesGateway()

    await expect(files.createFileSessionTextReadOperation(
      'file-session-test',
      '/srv/example.txt',
    )).resolves.toMatchObject({ path: '/srv/example.txt' })
    await expect(files.fileOperation('fop-test')).rejects.toBeInstanceOf(InvalidRemotePosixPathError)
  })

  it.each([
    ['文本结果', { file_session_id: 'file-session-test', path: '/srv/../etc/passwd' }],
    ['保存结果', {
      file: { path: '/srv/example.txt' },
      entry: { path: '/srv//example.txt' },
    }],
    ['批量重命名结果', {
      items: [{ source_path: '/srv/example.txt', target_path: '/srv/../example.txt' }],
    }],
    ['删除结果', { items: [{ path: '/srv/./example.txt' }] }],
  ])('拒绝 %s 中的非规范路径', async (_label, result) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify(result), { status: 200 }),
    ))

    await expect(createFilesGateway().fileOperationResult('fop-test'))
      .rejects.toBeInstanceOf(InvalidRemotePosixPathError)
  })

  it('接受五类结果的规范路径和不带路径的未来扩展结果', async () => {
    const results = [
      { file_session_id: 'file-session-test', path: '/srv/example.txt' },
      {
        file: { path: '/srv/example.txt' },
        entry: { path: '/srv/example.txt' },
      },
      {
        items: [{ source_path: '/srv/a.txt', target_path: '/srv/b.txt' }],
      },
      { items: [{ path: '/srv/example.txt' }] },
      { file_session_id: 'file-session-test', summary: { total: 1 } },
    ]
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      new Response(JSON.stringify(results.shift()), { status: 200 }),
    )))
    const files = createFilesGateway()

    for (let index = 0; index < 5; index += 1) {
      await expect(files.fileOperationResult(`fop-${index}`)).resolves.toBeDefined()
    }
  })
})
