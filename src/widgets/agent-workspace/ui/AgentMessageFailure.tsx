import { CircleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentResponseFailure as ResponseFailure } from '#entities/agent'
import type { AgentWorkspaceMessage } from '../model/types.ts'
import styles from './AgentMessageFailure.module.scss'

const mcpFailureKeys = new Map(Object.entries({
  AGENT_MCP_PROTOCOL_MISMATCH: 'mcpProtocolMismatch',
  AGENT_MCP_ENDPOINT_INVALID: 'mcpEndpointInvalid',
  AGENT_MCP_ENDPOINT_VIOLATION: 'mcpEndpointViolation',
  AGENT_MCP_TOOL_NAME_CONFLICT: 'mcpToolNameConflict',
  AGENT_MCP_TOOL_SCHEMA_INVALID: 'mcpToolSchemaInvalid',
  AGENT_MCP_TOOLS_EMPTY: 'mcpToolsEmpty',
  AGENT_MCP_CONNECTION_FAILED: 'mcpConnectionFailed',
}))

const failureKeys = new Map(Object.entries({
  AGENT_MODEL_STREAM_INTERRUPTED: 'streamInterrupted',
  AGENT_MODEL_TIMEOUT: 'timeout',
  AGENT_MODEL_RATE_LIMITED: 'rateLimited',
  AGENT_MODEL_AUTH_FAILED: 'authFailed',
  AGENT_MODEL_CONTEXT_LIMIT: 'contextLimit',
  AGENT_MODEL_PROVIDER_FAILED: 'providerFailed',
  AGENT_MODEL_CONTENT_FILTERED: 'contentFiltered',
  AGENT_MODEL_REQUEST_FAILED: 'requestFailed',
  AGENT_RUNTIME_CONTEXT_COMPRESSION_STREAM_INTERRUPTED: 'compactionStreamInterrupted',
  AGENT_RUNTIME_CONTEXT_COMPRESSION_TIMEOUT: 'compactionTimeout',
  AGENT_RUNTIME_CONTEXT_COMPRESSION_RATE_LIMITED: 'compactionRateLimited',
  AGENT_RUNTIME_CONTEXT_COMPRESSION_AUTH_FAILED: 'compactionAuthFailed',
  AGENT_RUNTIME_CONTEXT_COMPRESSION_CONTEXT_LIMIT: 'compactionContextLimit',
  AGENT_RUNTIME_CONTEXT_COMPRESSION_PROVIDER_FAILED: 'compactionProviderFailed',
  AGENT_RUNTIME_CONTEXT_COMPRESSION_CONTENT_FILTERED: 'compactionContentFiltered',
  AGENT_RUNTIME_CONTEXT_COMPRESSION_TRUNCATED: 'compactionTruncated',
  AGENT_RUNTIME_CONTEXT_COMPRESSION_CHECKPOINT_FAILED: 'compactionCheckpointFailed',
  AGENT_RUNTIME_CONTEXT_COMPRESSION_UNAVAILABLE: 'compactionUnavailable',
  AGENT_RUNTIME_CONTEXT_COMPRESSION_INSUFFICIENT: 'compactionInsufficient',
  AGENT_RUNTIME_CONTEXT_COMPRESSION_ABORTED: 'compactionAborted',
  AGENT_RUNTIME_CONTEXT_COMPRESSION_SETTINGS_INVALID: 'compactionSettingsInvalid',
  AGENT_RUNTIME_CONTEXT_COMPRESSION_BOUNDARY_INVALID: 'compactionInvalid',
  AGENT_RUNTIME_CONTEXT_COMPRESSION_DETAILS_INVALID: 'compactionInvalid',
  AGENT_RUNTIME_CONTEXT_COMPRESSION_INVALID: 'compactionInvalid',
}))

export function AgentMessageFailure({ message }: {
  message: Pick<AgentWorkspaceMessage, 'status' | 'error_code' | 'error_message'> & Partial<Pick<AgentWorkspaceMessage, 'parts'>>
}) {
  const { t } = useTranslation()
  if (message.status !== 'failed' && message.status !== 'interrupted' && message.status !== 'interrupted_by_steer') return null
  const mcpReason = message.status === 'failed' && message.error_code
    ? mcpFailureKeys.get(message.error_code) : undefined
  const reason = message.status === 'failed' && message.error_code
    ? mcpReason ?? failureKeys.get(message.error_code)
      ?? (message.error_code.startsWith('AGENT_RUNTIME_CONTEXT_COMPRESSION_') ? 'compactionFailed' : undefined)
    : undefined
  const errorAlreadyShown = message.parts?.some((part) => (
    part.kind === 'response_failure' && part.failure.error_message === message.error_message
    || part.kind === 'retry' && part.activity.status === 'failed' && part.activity.error_message === message.error_message
  ))
  // MCP 启动错误仅含固定安全说明，按错误码本地化，避免重复显示原语言说明。
  const details = message.status === 'failed' && !errorAlreadyShown && !mcpReason ? message.error_message : undefined
  return (
    <div className={styles.failure} data-status={message.status}>
      <CircleAlert size={14} aria-hidden="true" />
      <div className={styles.content}>
        <span>{t(reason ? `agent.message.failure.${reason}` : `agent.message.${message.status}`)}</span>
        {details ? <span className={styles.details}>{details}</span> : null}
      </div>
    </div>
  )
}

export function AgentResponseFailure({ failure }: { failure: ResponseFailure }) {
  if (!failure.error_message) return null
  return (
    <div className={styles.failure} data-response-attempt-id={failure.attempt_id} aria-live="off">
      <CircleAlert size={14} aria-hidden="true" />
      <span className={`${styles.content} ${styles.details}`}>{failure.error_message}</span>
    </div>
  )
}
