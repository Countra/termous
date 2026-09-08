import type { TerminalAICompletionCancel, TerminalAICompletionRequest, TerminalAICompletionResult } from '#common/contracts'
import { isRecord } from '../agent/protocol.ts'
import { isRuntimeModelSnapshot, type RuntimeModelSnapshot } from '../agent/workerCoreClient.ts'
import type { RuntimeUsage } from '../agent/runtimeUsage.ts'

export interface TerminalCompletionBootstrap {
  request_id: string
  model: { snapshot: RuntimeModelSnapshot; api_key?: string }
  environment: { os: string; shell: string; cwd: string }
}

export interface TerminalCompletionStart {
  type: 'start'
  request: TerminalAICompletionRequest
  bootstrap: TerminalCompletionBootstrap
}

export const terminalCompletionTimeoutMs = 30_000
export const terminalCompletionAbortGraceMs = 2_000
const controlCharacters = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u
const identity = /^[A-Za-z0-9_-]{1,128}$/u

export function isTerminalCompletionCancel(value: unknown): value is TerminalAICompletionCancel {
  return isRecord(value) && typeof value.requestId === 'string' && identity.test(value.requestId)
    && typeof value.sessionId === 'string' && identity.test(value.sessionId)
}

export function isTerminalCompletionRequest(value: unknown): value is TerminalAICompletionRequest {
  if (!isRecord(value) || !isTerminalCompletionCancel(value) || !isRecord(value.inputSnapshot)
    || !validText(value.prompt, 4096, true) || !value.prompt.trim()) return false
  const snapshot = value.inputSnapshot
  return typeof snapshot.shellId === 'string' && snapshot.shellId.length > 0 && snapshot.shellId.length <= 128
    && !controlCharacters.test(snapshot.shellId)
    && [snapshot.sourceGeneration, snapshot.promptGeneration].every((number) => Number.isSafeInteger(number) && Number(number) > 0)
    && [snapshot.inputEpoch, snapshot.revision].every((number) => Number.isSafeInteger(number) && Number(number) >= 0)
    && validText(snapshot.line, 4096)
    && Number.isSafeInteger(snapshot.cursorUtf16) && snapshot.cursorUtf16 === snapshot.line.length
}

export function isTerminalCompletionBootstrap(value: unknown, requestId: string): value is TerminalCompletionBootstrap {
  return isRecord(value) && value.request_id === requestId
    && isRecord(value.model) && isRuntimeModelSnapshot(value.model.snapshot)
    && (value.model.api_key === undefined || validText(value.model.api_key, 16 * 1024))
    && isRecord(value.environment) && validText(value.environment.os, 128)
    && validText(value.environment.shell, 128) && validText(value.environment.cwd, 16 * 1024)
}

export function isTerminalCompletionStart(value: unknown): value is TerminalCompletionStart {
  return isRecord(value) && value.type === 'start' && isTerminalCompletionRequest(value.request)
    && isTerminalCompletionBootstrap(value.bootstrap, value.request.requestId)
}

export function isTerminalCompletionResult(value: unknown, request: TerminalAICompletionRequest): value is TerminalAICompletionResult {
  if (!isRecord(value) || value.requestId !== request.requestId || value.sessionId !== request.sessionId
    || !isRecord(value.inputSnapshot)) return false
  const snapshot = value.inputSnapshot
  if (!(['sourceGeneration', 'shellId', 'promptGeneration', 'inputEpoch', 'line', 'cursorUtf16', 'revision'] as const)
    .every((key) => snapshot[key] === request.inputSnapshot[key])) return false
  if (value.status === 'completed') {
    return validText(value.command, 4096) && value.command.trim().length > 0
      && validText(value.description, 2048) && value.description.trim().length > 0 && isRecord(value.model)
      && validText(value.model.id, 512) && validText(value.model.name, 512) && validText(value.model.providerName, 512)
  }
  return (value.status === 'failed' || value.status === 'cancelled')
    && typeof value.code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/u.test(value.code)
    && validText(value.message, 4096, true)
}

export function validText(value: unknown, bytes: number, multiline = false): value is string {
  return typeof value === 'string' && Buffer.from(value, 'utf8').toString('utf8') === value && Buffer.byteLength(value, 'utf8') <= bytes
    && !controlCharacters.test(multiline ? value.replace(/[\r\n\t]/gu, '') : value)
}

export function completionFailure(request: TerminalAICompletionRequest, code: string, message: string): TerminalAICompletionResult {
  return {
    requestId: request.requestId, sessionId: request.sessionId, inputSnapshot: request.inputSnapshot,
    status: code === 'TERMINAL_AI_CANCELLED' ? 'cancelled' : 'failed', code, message,
  }
}

export function isTerminalCompletionUsage(value: unknown, requestId: string): value is { type: 'usage'; requestId: string; usage: RuntimeUsage } {
  if (!isRecord(value) || value.type !== 'usage' || value.requestId !== requestId || !isRecord(value.usage)) return false
  const counts = ['input_tokens', 'cache_read_tokens', 'cache_write_tokens', 'output_tokens', 'reasoning_tokens', 'total_tokens']
  const usage = value.usage
  return Object.keys(usage).every((key) => counts.includes(key) || key === 'estimated')
    && counts.every((key) => Number.isSafeInteger(usage[key]) && Number(usage[key]) >= 0)
    && typeof usage.estimated === 'boolean'
}
