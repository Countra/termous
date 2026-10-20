import type { ChildProcess } from 'node:child_process'
export function stopDevelopmentProcess(child?: ChildProcess, timeoutMs?: number): Promise<void>
