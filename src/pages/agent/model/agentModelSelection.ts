import type { AgentModel, AgentReasoningLevel } from '#entities/agent'

export function resolveAgentModelReasoningLevel(
  model: AgentModel | undefined,
  requested: AgentReasoningLevel,
): AgentReasoningLevel {
  if (!model) return 'off'
  if (model.supported_reasoning_levels.includes(requested)) return requested
  if (model.supported_reasoning_levels.includes(model.effective_default_reasoning_level)) {
    return model.effective_default_reasoning_level
  }
  return 'off'
}
