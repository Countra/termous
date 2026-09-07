export class AgentSkillBundleError extends Error {
  readonly category: string

  constructor(category: string, cause?: unknown) {
    super('AGENT_SKILLS_BUNDLE_INVALID')
    this.name = 'AgentSkillBundleError'
    this.category = category
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause, configurable: true })
    }
  }
}

export function stableSkillBundleErrorCategory(error: unknown) {
  return error instanceof AgentSkillBundleError && /^[a-z0-9_]{1,64}$/.test(error.category)
    ? error.category
    : 'bundle_unavailable'
}
