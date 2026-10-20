import type { ChildProcess, SpawnOptions } from 'node:child_process'

interface StartContext {
  startup(argv?: string[], options?: SpawnOptions, customElectronPkg?: string): Promise<unknown>
  reload(): void
}

export function createDevelopmentStarter(options: {
  prepare(): Promise<string>
  child(): ChildProcess | undefined
  cwd: string
  report(error: unknown): void
  stop?: (child?: ChildProcess) => Promise<void>
}): {
  run(context: StartContext, restart?: boolean): Promise<void>
  close(): Promise<void>
}
