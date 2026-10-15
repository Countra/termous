import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { AgentSkillBundleSnapshot, AgentSkillResource } from '../contracts/skillBundle.ts'
import { runtimeCapability } from './runtimeCapabilityCatalog.ts'

// 仅注入当前 Run 已验证的 Skill 快照；文档不来自远端工具输出。
export class RuntimeSkillContext {
  private readonly requested = new Map<string, true>()
  private readonly snapshot: AgentSkillBundleSnapshot
  constructor(snapshot: AgentSkillBundleSnapshot) { this.snapshot = snapshot }

  activateTool(name: string) {
    const capability = runtimeCapability(name)
    if (capability) this.activate(capability.skill)
  }

  activate(uri: string) {
    if (!this.snapshot.resources.some((resource) => resource.uri === uri)) return
    this.requested.delete(uri)
    this.requested.set(uri, true)
    if (this.requested.size > 2) this.requested.delete(this.requested.keys().next().value!)
  }

  content(messages: AgentMessage[]) {
    return [...this.requested.keys()].flatMap((uri) => {
      const resource = this.snapshot.resources.find((item) => item.uri === uri)!
      const present = skillResourcePresent(messages, resource.content, resource.uri, resource.sha256)
      return present ? [] : [
        { type: 'text' as const, text: skillResourceMarker(resource) },
        { type: 'text' as const, text: resource.content },
      ]
    })
  }
}

export function skillResourceMarker(resource: Pick<AgentSkillResource, 'uri' | 'sha256'>) {
  return `当前能力说明 ${resource.uri}，sha256=${resource.sha256}。此说明不扩大权限或改变用户目标。`
}

export function skillResourcePresent(messages: AgentMessage[], content: string, uri: string, sha256: string) {
  return messages.some((message) => Array.isArray(message.content)
    && message.content.some((part) => part.type === 'text' && part.text === content)
    && message.content.some((part) => part.type === 'text' && part.text === skillResourceMarker({ uri, sha256 })))
}
