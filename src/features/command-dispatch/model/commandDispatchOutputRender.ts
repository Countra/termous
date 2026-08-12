import type { AppTheme, TerminalSettings } from '#common/contracts'
import { terminalTheme } from '#entities/settings'
import type { CommandDispatchOutputSnapshot } from './commandDispatchOutputStore.ts'

export interface CommandDispatchOutputRenderCursor {
  revision: number
  resetRevision: number
  writtenBytes: number
}

export interface CommandDispatchOutputRenderPlan {
  mode: 'none' | 'append' | 'reset'
  data: Uint8Array
  cursor: CommandDispatchOutputRenderCursor
}

export function createCommandDispatchOutputRenderCursor(): CommandDispatchOutputRenderCursor {
  return {
    revision: -1,
    resetRevision: -1,
    writtenBytes: 0,
  }
}

export function commandDispatchOutputTheme(settings: TerminalSettings, appTheme: AppTheme) {
  return {
    ...terminalTheme(settings, appTheme),
    cursor: 'transparent',
  }
}

export function planCommandDispatchOutputRender(
  current: CommandDispatchOutputRenderCursor,
  output: CommandDispatchOutputSnapshot,
): CommandDispatchOutputRenderPlan {
  if (output.revision === 0) {
    return { mode: 'none', data: new Uint8Array(), cursor: current }
  }

  // React 可能合并连续的外部 Store 更新。revision 跳跃时必须以累计数据完整重放，
  // 不能依赖只存在于某个中间快照中的 chunk。
  const revisionJumped = current.revision >= 0 && output.revision !== current.revision + 1
  const mustReset = current.revision < 0
    || revisionJumped
    || output.resetRevision !== current.resetRevision
    || output.data.byteLength < current.writtenBytes
  const cursor = {
    revision: output.revision,
    resetRevision: output.resetRevision,
    writtenBytes: output.data.byteLength,
  }

  if (mustReset) {
    return { mode: 'reset', data: output.data, cursor }
  }
  if (output.data.byteLength > current.writtenBytes) {
    return {
      mode: 'append',
      data: output.data.slice(current.writtenBytes),
      cursor,
    }
  }
  return { mode: 'none', data: new Uint8Array(), cursor }
}
