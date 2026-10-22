export function buildOutputPaths(webDirectory: string, env?: NodeJS.ProcessEnv): {
  renderer: string; electron: string; skills: string; verification: string; managed: boolean
}
export function requireManagedPath(root: string | undefined, value: string | undefined): string
