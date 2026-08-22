import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AdvancedRenameExecutionResult,
  AdvancedRenamePreview,
  AdvancedRenameRule,
  FileOperationTask,
  FileRenamePreset,
  FileRenamePresetInput,
  RemoteFileEntry,
} from '#entities/file'
import type { FileGateway } from '#features/files'
import type { AdvancedRenameModalProps } from '../model/types'
import { useAdvancedRenameController } from './useAdvancedRenameController'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

const sourceEntry: RemoteFileEntry = {
  name: 'demo.txt',
  path: '/srv/demo.txt',
  kind: 'file',
  size: 4,
  is_hidden: false,
}

function preview(planHash = 'plan-1'): AdvancedRenamePreview {
  return {
    plan_hash: planHash,
    items: [{
      source_path: sourceEntry.path,
      original_name: sourceEntry.name,
      final_name: 'renamed.txt',
      kind: 'file',
      size: 4,
      status: 'ready',
      diagnostics: [],
    }],
    summary: { total: 1, changed: 1, unchanged: 0, excluded: 0, blocked: 0 },
  }
}

function operation(status: FileOperationTask['status'] = 'completed'): FileOperationTask {
  return {
    id: 'operation-1',
    revision: 1,
    file_session_id: 'file-session-1',
    host_id: 'host-1',
    type: 'batch_rename',
    status,
    phase: status === 'completed' ? 'done' : 'rollback',
    path: '/srv',
    total_bytes: 0,
    transferred_bytes: 0,
    remaining_bytes: 0,
    phase_total_bytes: 0,
    phase_transferred_bytes: 0,
    phase_progress_percent: status === 'completed' ? 100 : 50,
    progress_percent: status === 'completed' ? 100 : 50,
    speed_bytes_per_sec: 0,
    average_speed_bytes_per_sec: 0,
    elapsed_seconds: 0,
    cancellable: false,
    created_at: '2026-08-21T00:00:00Z',
    error_code: status === 'failed' ? 'SFTP_BATCH_RENAME_FAILED' : undefined,
  }
}

function serverOrderedRules(rules: readonly AdvancedRenameRule[]) {
  return rules.map((rule) => ({
    id: rule.id,
    kind: rule.kind,
    enabled: rule.enabled,
    ...(rule.condition ? { condition: {
      ...rule.condition,
      kinds: rule.condition.kinds ?? [],
      extensions: rule.condition.extensions ?? [],
    } } : {}),
    config: rule.config,
  })) as AdvancedRenameRule[]
}

const executionResult: AdvancedRenameExecutionResult = {
  plan_hash: 'plan-1',
  items: [{ source_path: '/srv/demo.txt', target_path: '/srv/renamed.txt', status: 'renamed' }],
  summary: { total: 1, renamed: 1, unchanged: 0, excluded: 0, rolled_back: 0, failed: 0, uncertain: 0 },
  partial: false,
  uncertain: false,
}

function props(apiPatch: Partial<FileGateway> = {}, patch: Partial<AdvancedRenameModalProps> = {}) {
  const api = {
    fileRenamePresets: vi.fn(async () => []),
    previewFileSessionBatchRename: vi.fn(async () => preview()),
    createFileSessionBatchRename: vi.fn(async () => operation()),
    fileOperationResult: vi.fn(async () => executionResult) as unknown as FileGateway['fileOperationResult'],
    fileOperation: vi.fn(async () => operation()),
    fileOperationEventsUrl: vi.fn(() => 'ws://localhost/file-operations'),
    cancelFileOperation: vi.fn(async () => undefined),
    ...apiPatch,
  } as unknown as FileGateway
  return {
    api,
    open: true,
    source: {
      fileSessionId: 'file-session-1',
      connectionGeneration: 3,
      directory: '/srv',
      entries: [sourceEntry],
    },
    onClose: vi.fn(),
    onCompleted: vi.fn(),
    onDirectoryRefresh: vi.fn(),
    ...patch,
  } satisfies AdvancedRenameModalProps
}

afterEach(() => {
  vi.useRealTimers()
})

describe('高级重命名控制器', () => {
  it('修改默认草稿后标记为未保存并在前端限制最多 32 条规则', async () => {
    const options = props()
    const view = renderHook(() => useAdvancedRenameController(options))
    await waitFor(() => expect(view.result.current.presetsLoading).toBe(false))
    expect(view.result.current.presetDirty).toBe(false)
    expect(view.result.current.draftDirty).toBe(false)

    act(() => {
      for (let index = 0; index < 40; index += 1) {
        view.result.current.addRule('insert')
      }
    })

    expect(view.result.current.presetDirty).toBe(true)
    expect(view.result.current.draftDirty).toBe(true)
    expect(view.result.current.rules).toHaveLength(32)
    act(() => view.result.current.duplicateRule(view.result.current.rules[0].id))
    expect(view.result.current.rules).toHaveLength(32)
  })

  it('本次变量值、排除项和手工覆盖只标记草稿变更，不污染预设变更状态', async () => {
    const preset: FileRenamePreset = {
      id: 'preset-runtime',
      name: '运行参数',
      description: '',
      rules: [{ id: 'rule-runtime', kind: 'template', enabled: true, config: { template: '{{vars.release}}-{{file.original}}' } }],
      order: { by: 'selection', direction: 'asc' },
      variable_definitions: [{
        name: 'release', label: '版本', description: '', default_value: '2026.08', required: true,
      }],
      created_at: '2026-08-21T00:00:00Z',
      updated_at: '2026-08-21T00:00:00Z',
    }
    const options = props({ fileRenamePresets: vi.fn(async () => [preset]) })
    const view = renderHook(() => useAdvancedRenameController(options))
    await waitFor(() => expect(view.result.current.presets).toHaveLength(1))

    act(() => view.result.current.applyPreset(preset))
    expect(view.result.current.presetDirty).toBe(false)
    expect(view.result.current.draftDirty).toBe(false)

    act(() => view.result.current.setVariables({ release: '2026.09' }))
    expect(view.result.current.presetDirty).toBe(false)
    expect(view.result.current.draftDirty).toBe(true)

    act(() => view.result.current.applyPreset(preset))
    act(() => view.result.current.toggleExcluded(sourceEntry.path))
    expect(view.result.current.presetDirty).toBe(false)
    expect(view.result.current.draftDirty).toBe(true)

    act(() => view.result.current.applyPreset(preset))
    act(() => view.result.current.setManualOverride(sourceEntry.path, 'manual.txt'))
    expect(view.result.current.presetDirty).toBe(false)
    expect(view.result.current.draftDirty).toBe(true)
  })

  it('创建和更新预设成功后立即使用服务端结果重置变更状态', async () => {
    const createFileRenamePreset = vi.fn(async (input: FileRenamePresetInput) => ({
      id: 'preset-saved',
      ...input,
      rules: serverOrderedRules(input.rules),
      created_at: '2026-08-21T00:00:00Z',
      updated_at: '2026-08-21T00:00:00Z',
    }))
    const updateFileRenamePreset = vi.fn(async (
      _id: string,
      _expectedUpdatedAt: string,
      input: FileRenamePresetInput,
    ) => ({
      id: 'preset-saved',
      ...input,
      rules: serverOrderedRules(input.rules),
      created_at: '2026-08-21T00:00:00Z',
      updated_at: '2026-08-21T00:01:00Z',
    }))
    const options = props({ createFileRenamePreset, updateFileRenamePreset })
    const view = renderHook(() => useAdvancedRenameController(options))
    await waitFor(() => expect(view.result.current.presetsLoading).toBe(false))

    act(() => view.result.current.updateRule({ ...view.result.current.rules[0], condition: {} }))
    await act(async () => {
      await view.result.current.savePreset('已保存预设', '')
    })
    expect(view.result.current.selectedPreset?.id).toBe('preset-saved')
    expect(view.result.current.rules[0].condition).toEqual({})
    expect(view.result.current.selectedPreset?.rules[0].condition).toEqual({ kinds: [], extensions: [] })
    expect(view.result.current.presetDirty).toBe(false)

    act(() => view.result.current.addRule('case'))
    expect(view.result.current.presetDirty).toBe(true)
    await act(async () => {
      await view.result.current.updatePreset()
    })
    expect(view.result.current.presetDirty).toBe(false)
  })

  it('变量定义非法或重名时暂停预览并阻止保存和执行', async () => {
    vi.useFakeTimers()
    const previewFileSessionBatchRename = vi.fn(async () => preview())
    const createFileRenamePreset = vi.fn()
    const options = props({ previewFileSessionBatchRename, createFileRenamePreset })
    const view = renderHook(() => useAdvancedRenameController(options))

    act(() => view.result.current.setVariableDefinitions([
      { name: 'release', label: '版本', description: '', default_value: '', required: false },
      { name: 'release', label: '渠道', description: '', default_value: '', required: false },
    ]))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(view.result.current.variableDefinitionErrors).toEqual(['duplicate', 'duplicate'])
    expect(view.result.current.variableDefinitionsValid).toBe(false)
    expect(view.result.current.canExecute).toBe(false)
    expect(previewFileSessionBatchRename).not.toHaveBeenCalled()
    await expect(view.result.current.savePreset('invalid', '')).resolves.toBeNull()
    expect(createFileRenamePreset).not.toHaveBeenCalled()
    await expect(view.result.current.execute()).resolves.toBe(false)
  })

  it('预览使用 250ms 防抖并忽略被后续规则变更取消的迟到响应', async () => {
    vi.useFakeTimers()
    const first = deferred<AdvancedRenamePreview>()
    const second = deferred<AdvancedRenamePreview>()
    const previewFileSessionBatchRename = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const options = props({ previewFileSessionBatchRename })
    const view = renderHook(() => useAdvancedRenameController(options))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(249)
    })
    expect(previewFileSessionBatchRename).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(previewFileSessionBatchRename).toHaveBeenCalledTimes(1)
    const firstSignal = previewFileSessionBatchRename.mock.calls[0][2] as AbortSignal

    act(() => view.result.current.addRule('case'))
    expect(firstSignal.aborted).toBe(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(previewFileSessionBatchRename).toHaveBeenCalledTimes(2)

    await act(async () => {
      second.resolve(preview('plan-new'))
      await Promise.resolve()
    })
    expect(view.result.current.preview?.plan_hash).toBe('plan-new')
    await act(async () => {
      first.resolve(preview('plan-stale'))
      await Promise.resolve()
    })
    expect(view.result.current.preview?.plan_hash).toBe('plan-new')
  })

  it('创建任务等待期间拒绝重复提交并只执行一次', async () => {
    vi.useFakeTimers()
    const created = deferred<FileOperationTask>()
    const createFileSessionBatchRename = vi.fn(() => created.promise)
    const onCompleted = vi.fn()
    const options = props(
      { createFileSessionBatchRename },
      { onCompleted },
    )
    const view = renderHook(() => useAdvancedRenameController(options))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
      await Promise.resolve()
    })
    expect(view.result.current.canExecute).toBe(true)

    let firstExecution!: Promise<boolean>
    let duplicateExecution!: Promise<boolean>
    act(() => {
      firstExecution = view.result.current.execute()
      duplicateExecution = view.result.current.execute()
    })
    await expect(duplicateExecution).resolves.toBe(false)
    expect(createFileSessionBatchRename).toHaveBeenCalledTimes(1)
    expect(view.result.current.executionSubmitting).toBe(true)

    await act(async () => {
      created.resolve(operation())
      await firstExecution
    })
    expect(onCompleted).toHaveBeenCalledWith(executionResult)
    expect(view.result.current.executionSubmitting).toBe(false)
  })

  it('控制器卸载后取消迟到创建的任务且不启动任务观察', async () => {
    vi.useFakeTimers()
    const created = deferred<FileOperationTask>()
    const createFileSessionBatchRename = vi.fn(() => created.promise)
    const cancelFileOperation = vi.fn(async () => undefined)
    const fileOperation = vi.fn(async () => operation('running'))
    const fileOperationResult = vi.fn(async () => executionResult)
    const options = props({
      createFileSessionBatchRename,
      cancelFileOperation,
      fileOperation,
      fileOperationResult: fileOperationResult as unknown as FileGateway['fileOperationResult'],
    })
    const view = renderHook(() => useAdvancedRenameController(options))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
      await Promise.resolve()
    })

    let execution!: Promise<boolean>
    act(() => {
      execution = view.result.current.execute()
    })
    expect(createFileSessionBatchRename).toHaveBeenCalledTimes(1)

    view.unmount()
    await act(async () => {
      created.resolve(operation('running'))
      await execution
    })

    expect(cancelFileOperation).toHaveBeenCalledWith('operation-1')
    expect(fileOperation).not.toHaveBeenCalled()
    expect(fileOperationResult).not.toHaveBeenCalled()
  })

  it('失败任务读取结果并刷新目录但不触发成功关闭流程', async () => {
    vi.useFakeTimers()
    const previewFileSessionBatchRename = vi.fn(async () => preview())
    const failedResult: AdvancedRenameExecutionResult = {
      ...executionResult,
      summary: { ...executionResult.summary, renamed: 0, rolled_back: 1, failed: 1 },
      partial: true,
    }
    const onCompleted = vi.fn()
    const onDirectoryRefresh = vi.fn()
    const options = props({
      previewFileSessionBatchRename,
      createFileSessionBatchRename: vi.fn(async () => operation('failed')),
      fileOperationResult: vi.fn(async () => failedResult) as unknown as FileGateway['fileOperationResult'],
    }, { onCompleted, onDirectoryRefresh })
    const view = renderHook(() => useAdvancedRenameController(options))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
      await Promise.resolve()
    })

    await act(async () => {
      await view.result.current.execute()
    })

    expect(onDirectoryRefresh).toHaveBeenCalledWith(failedResult)
    expect(onCompleted).not.toHaveBeenCalled()
    expect(view.result.current.executionResult).toEqual(failedResult)
    expect(view.result.current.executionError).toBe('SFTP_BATCH_RENAME_FAILED')
    expect(view.result.current.executionTask).toBeNull()
    expect(previewFileSessionBatchRename).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(previewFileSessionBatchRename).toHaveBeenCalledTimes(1)

    act(() => view.result.current.continueEditing())
    expect(view.result.current.executionResult).toBeNull()
    expect(view.result.current.executionError).toBe('')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(previewFileSessionBatchRename).toHaveBeenCalledTimes(2)
    expect(view.result.current.preview).toEqual(preview())
  })

  it('失败结果读取异常时仍刷新目录并释放旧任务观察状态', async () => {
    vi.useFakeTimers()
    const onDirectoryRefresh = vi.fn()
    const options = props({
      createFileSessionBatchRename: vi.fn(async () => operation('failed')),
      fileOperationResult: vi.fn(async () => { throw new Error('RESULT_UNAVAILABLE') }) as unknown as FileGateway['fileOperationResult'],
    }, { onDirectoryRefresh })
    const view = renderHook(() => useAdvancedRenameController(options))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
      await Promise.resolve()
    })
    await act(async () => {
      await view.result.current.execute()
    })
    expect(onDirectoryRefresh).toHaveBeenCalledWith()
    expect(view.result.current.executionTask).toBeNull()
    expect(view.result.current.executionError).toBe('RESULT_UNAVAILABLE')
  })

  it('更新预设透传服务端 updated_at 作为条件写入版本', async () => {
    const preset: FileRenamePreset = {
      id: 'preset-1',
      name: '发布文件',
      description: '',
      rules: [{ id: 'rule-1', kind: 'template', enabled: true, config: { template: '{{file.original}}' } }],
      order: { by: 'selection', direction: 'asc' },
      variable_definitions: [],
      created_at: '2026-08-21T00:00:00Z',
      updated_at: '2026-08-21T01:02:03Z',
    }
    const updateFileRenamePreset = vi.fn(async () => ({ ...preset, updated_at: '2026-08-21T02:00:00Z' }))
    const options = props({
      fileRenamePresets: vi.fn(async () => [preset]),
      updateFileRenamePreset,
    })
    const view = renderHook(() => useAdvancedRenameController(options))
    await waitFor(() => expect(view.result.current.presets).toHaveLength(1))
    act(() => view.result.current.applyPreset(preset))
    act(() => view.result.current.addRule('case'))

    await act(async () => {
      await view.result.current.updatePreset()
    })

    expect(updateFileRenamePreset).toHaveBeenCalledWith(
      preset.id,
      preset.updated_at,
      expect.objectContaining({ name: preset.name }),
    )
  })
})
