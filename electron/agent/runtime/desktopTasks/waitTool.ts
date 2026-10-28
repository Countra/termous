import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import type { DesktopTaskCoordinator } from './coordinator.ts'
import { desktopTaskToolResult } from '../../contracts/desktopTaskResult.ts'

export function desktopWaitTool(tasks: DesktopTaskCoordinator, observe?: (output: Record<string, unknown>) => void): AgentTool {
  return {
    name: 'wait_desktop_execution', label: '等待桌面操作', executionMode: 'sequential',
    description: 'Wait for an existing desktop execution without polling or starting another model request. Use this when no independent work remains. Returns its original terminal receipt and screenshot; never replays input.',
    parameters: Type.Object({ execution_id: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false }),
    execute: async (_id, args, signal) => {
      const receipt = await tasks.wait((args as { execution_id: string }).execution_id, signal)
      // 显式等待和自动接续共用本轮截图登记，历史图片仍不能恢复旧坐标授权。
      observe?.(receipt.result)
      return desktopTaskToolResult(receipt)
    },
  }
}
