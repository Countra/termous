import { createHash } from 'node:crypto'
import type { IntegrationDirectory } from '../contracts/integrationIPC.ts'
import { externalToolSource } from '../contracts/toolSources.ts'
import type { LazySkillSource } from '../tools/runtimeSkillDirectory.ts'
import type { IntegrationSkillRead } from '#common/agent-integrations'
import { WorkerIntegrationProxy } from './integrationProxy.ts'

export function integrationSkills(directory: IntegrationDirectory, proxy: WorkerIntegrationProxy): LazySkillSource[] {
  return directory.sources.flatMap(source => {
    const manifest = source.skill
    if (source.kind !== 'skill' || !manifest || !manifest.allow_implicit && !source.skill_selected) return []
    const root = `skill://sources/${source.id}/${manifest.version}/`
    const paths = new Map(manifest.files.map(file => [root + file.path, file.path]))
    return [{ entry: { source: externalToolSource(source.id, 'skill'), name: manifest.name, description: manifest.description, entry_uri: root + 'SKILL.md' },
      version: manifest.version, uris: [...paths.keys()],
      read: async (uri: string, offset: number, signal?: AbortSignal, toolCallID?: string) => {
        const path = paths.get(uri)
        if (!path) throw new Error('AGENT_SKILL_RESOURCE_NOT_FOUND')
        const value = await proxy.request<IntegrationSkillRead>({ action: 'skill', source: source.id, version: manifest.version, path, offset,tool_call_id:toolCallID ?? '' }, signal)
        const content = value.text ?? JSON.stringify({path:value.path,mime_type:value.mime_type,resource:value.resource,image_ref:value.image_ref})
        return { uri, content, size: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex'), image_ref:value.image_ref,
          media_type: 'text/markdown; charset=utf-8' as const, next_offset: value.next_offset, done: value.done,
          references: value.files?.map(file => root + file.path), missing_dependencies: value.missing_dependencies }
      },
    }]
  })
}
