export interface AgentLocalDirectory { path: string; managed: boolean; revision: number }

export function decodeAgentLocalDirectory(value: unknown): AgentLocalDirectory {
  if (!value || typeof value !== 'object' || !('path' in value) || typeof value.path !== 'string'
    || !value.path || value.path.length > 32768 || !('managed' in value) || typeof value.managed !== 'boolean'
    || !('revision' in value) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1) throw new Error('LOCAL_DIRECTORY_INVALID')
  return { path: value.path, managed: value.managed, revision: Number(value.revision) }
}
