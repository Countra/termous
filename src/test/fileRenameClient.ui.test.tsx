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

const legacyPreset = {
  id: 'preset-legacy',
  name: '旧预设',
  rules: [],
  order: { by: 'selection', direction: 'asc' },
  variable_definitions: null,
  created_at: '2026-08-21T00:00:00Z',
  updated_at: '2026-08-21T00:00:00Z',
}

const legacyPresetWithVariable = {
  ...legacyPreset,
  variable_definitions: [{
    name: 'release',
    label: '发布版本',
    default_value: '2026.08',
    required: true,
  }],
}

const compactPreset = {
  ...legacyPreset,
  id: 'preset-compact',
  order: {},
  rules: [
    { id: 'template', kind: 'template', config: {} },
    {
      id: 'insert',
      kind: 'insert',
      config: {},
      condition: { original_name: {} },
    },
    { id: 'replace', kind: 'replace', enabled: true, config: { search: 'old' } },
    { id: 'slice', kind: 'slice', enabled: true, config: { mode: 'remove' } },
    { id: 'case', kind: 'case', enabled: true, config: {} },
    { id: 'cleanup', kind: 'cleanup', enabled: true, config: {} },
    { id: 'sequence', kind: 'sequence', enabled: true, config: {} },
    { id: 'extension', kind: 'extension', enabled: true, config: {} },
  ],
}

const renamePreview = {
  plan_hash: 'plan-hash',
  items: [{
    source_path: '/srv/example.txt',
    original_name: 'example.txt',
    final_name: 'renamed.txt',
    kind: 'file',
    size: 12,
    version_token: 'version-token',
    status: 'ready',
  }],
  summary: { total: 1, changed: 1, unchanged: 0, excluded: 0, blocked: 0 },
}

const renameOperation = {
  id: 'fop-rename',
  revision: 1,
  file_session_id: 'file-session-test',
  engine: 'sftp',
  type: 'batch_rename',
  status: 'queued',
  phase: 'queued',
  path: '/srv',
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

describe('文件重命名预设 API 兼容归一化', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('校验重命名预览和异步任务中的规范虚拟路径', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(renamePreview), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...renamePreview,
        items: [{ ...renamePreview.items[0], source_path: '/srv/../etc/passwd' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(renameOperation), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...renameOperation,
        path: '/srv//example',
      }), { status: 201 })))
    const files = createFilesGateway()
    const input = {
      expected_connection_generation: 1,
      directory: '/srv',
      source_paths: ['/srv/example.txt'],
      excluded_paths: [],
      rules: [],
      variables: {},
      order: { by: 'selection' as const, direction: 'asc' as const },
      manual_overrides: {},
    }

    await expect(files.previewFileSessionBatchRename('file-session-test', input))
      .resolves.toMatchObject({ items: [{ source_path: '/srv/example.txt' }] })
    await expect(files.previewFileSessionBatchRename('file-session-test', input))
      .rejects.toBeInstanceOf(InvalidRemotePosixPathError)
    await expect(files.createFileSessionBatchRename('file-session-test', {
      ...input,
      expected_plan_hash: 'plan-hash',
    })).resolves.toMatchObject({ path: '/srv' })
    await expect(files.createFileSessionBatchRename('file-session-test', {
      ...input,
      expected_plan_hash: 'plan-hash',
    })).rejects.toBeInstanceOf(InvalidRemotePosixPathError)
  })

  it('将旧 Core 返回的空说明和 null 变量定义归一化为前端合同', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([legacyPreset]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(legacyPreset), { status: 201 })))
    const files = createFilesGateway()

    await expect(files.fileRenamePresets()).resolves.toMatchObject([{
      description: '',
      rules: [],
      variable_definitions: [],
    }])
    await expect(files.createFileRenamePreset({
      name: '旧预设',
      description: '',
      rules: [],
      order: { by: 'selection', direction: 'asc' },
      variable_definitions: [],
    })).resolves.toMatchObject({
      description: '',
      rules: [],
      variable_definitions: [],
    })
  })

  it('补齐变量定义中被 Core 省略的空说明', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([legacyPresetWithVariable]), { status: 200 }),
    ))
    const files = createFilesGateway()

    await expect(files.fileRenamePresets()).resolves.toMatchObject([{
      variable_definitions: [{
        name: 'release',
        description: '',
      }],
    }])
  })

  it('补齐 Go omitempty 省略的合法规则零值和默认排序', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([compactPreset]), { status: 200 }),
    ))
    const files = createFilesGateway()

    await expect(files.fileRenamePresets()).resolves.toMatchObject([{
      order: { by: 'selection', direction: 'asc' },
      rules: [
        { enabled: false, config: { template: '' } },
        {
          enabled: false,
          config: { text: '', position: 'prefix', target: 'name' },
          condition: {
            kinds: [],
            original_name: { pattern: '', regex: false, case_sensitive: false },
            extensions: [],
          },
        },
        {
          enabled: true,
          config: {
            search: 'old',
            replacement: '',
            regex: false,
            replace_all: false,
            case_sensitive: false,
            target: 'name',
          },
        },
        {
          enabled: true,
          config: { mode: 'remove', start: 0, from_end: false, target: 'name' },
        },
        { enabled: true, config: { mode: 'lower', target: 'name' } },
        {
          enabled: true,
          config: {
            trim_whitespace: false,
            collapse_separator: false,
            target: 'name',
          },
        },
        {
          enabled: true,
          config: {
            position: 'prefix',
            start: 0,
            step: 0,
            width: 0,
            target: 'name',
          },
        },
        { enabled: true, config: { mode: 'remove' } },
      ],
    }])
  })
})
