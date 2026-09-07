import { projectToolTimelineValue } from './toolTimelineProjection.ts'

const failureRules = [
  ['AGENT_MODEL_CONTEXT_LIMIT', /context[_ -]?(?:length|window)|maximum context|too many (?:input )?tokens|input.{0,24}(?:too long|exceeds)/iu, '模型上下文超出服务端限制'],
  ['AGENT_MODEL_RATE_LIMITED', /\b429\b|rate[_ -]?limit|too many requests|insufficient[_ -]?quota|quota.{0,20}exceed/iu, '模型服务限流或额度不足'],
  ['AGENT_MODEL_AUTH_FAILED', /\b40[13]\b|authentication|unauthorized|invalid[_ -]?api[_ -]?key|permission denied/iu, '模型服务鉴权失败'],
  ['AGENT_MODEL_TIMEOUT', /timed?\s*out|timeout|ETIMEDOUT|\b(?:408|504)\b/iu, '模型请求超时'],
  ['AGENT_MODEL_CONTENT_FILTERED', /content[_ -]?filter|content[_ -]?policy|safety.{0,20}(?:block|filter)/iu, '模型服务未返回内容：触发内容限制'],
  ['AGENT_MODEL_STREAM_INTERRUPTED', /stream.{0,100}(?:ended|closed|interrupt)|terminal response event|stop reason|unexpected (?:end|eof)|ECONNRESET|socket hang up|connection error|fetch failed|terminated/iu, '模型响应连接中断，未收到完整结束事件'],
  ['AGENT_MODEL_PROVIDER_FAILED', /\b5\d\d\b|server[_ -]?error|internal[_ -]?(?:server[_ -]?)?error|service unavailable|overloaded/iu, '模型服务端处理失败'],
] as const

export function runtimeProviderFailure(message: string | undefined, secrets: readonly string[] = []) {
  const source = message ?? ''
  const rule = failureRules.find(([, pattern]) => pattern.test(source))
  const code = rule?.[0] ?? 'AGENT_MODEL_REQUEST_FAILED'
  const title = rule?.[2] ?? '模型请求失败'
  const detail = providerFailureDetail(source, secrets)
  return { code, message: detail ? `${title}：${detail}` : title }
}

function providerFailureDetail(source: string, secrets: readonly string[]) {
  let value = source
  // 供应商可能在错误正文中回显鉴权值，先移除本次实际凭据及其常见编码形式。
  for (const secret of secrets) {
    if (!secret) continue
    for (const variant of new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)])) {
      value = value.split(variant).join('[已隐藏]')
    }
  }
  value = value
    .replace(/https?:\/\/[^\s<>"']+/giu, '[地址已隐藏]')
    .replace(/(["'](?:authorization|api[_-]?key|token|secret|password|cookie|credential)["']\s*:\s*)"(?:\\.|[^"\\])*"/giu, '$1"[已隐藏]"')
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .trim()
  // 沿用工具详情的脱敏与 UTF-8 长度上限，错误记录保持在 Core 的 4 KiB 合同内。
  const projected = projectToolTimelineValue(value)
  return typeof projected === 'string' ? projected : ''
}
