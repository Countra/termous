import { agentToolImageReference } from '#common/contracts'
import type { AgentMessagePart } from '#entities/agent'
import type { AgentWorkspaceImage } from '#widgets/agent-workspace'

export function projectAgentToolImages(
  sessionID: string, part: Extract<AgentMessagePart, { kind: 'tool_result' }>,
): AgentWorkspaceImage[] {
  return (part.tool_result.images ?? []).flatMap((image) => {
    const reference = agentToolImageReference(part.tool_result.tool_call_id, image.content_index)
    return reference ? [{ ...image, reference,
      id: `${sessionID}:${part.message_id}:${part.id}:${part.revision}:${image.content_index}`,
      session_id: sessionID, message_id: part.message_id, part_id: part.id, revision: part.revision,
    }] : []
  })
}
