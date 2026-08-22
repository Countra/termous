import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeGatewaysFromConfig } from '#app/data-runtime'

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

describe('文件重命名预设 API 兼容归一化', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
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
