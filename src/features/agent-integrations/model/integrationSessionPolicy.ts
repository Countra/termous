import type { IntegrationPolicy, IntegrationSelection } from '#entities/agent-integrations'

type Source = IntegrationSelection['sources'][number]

export function integrationSessionState(source: Source, policy: IntegrationPolicy) {
  const skill = source.kind === 'skill'
  const ready = !skill || Boolean(source.version) && typeof source.allow_implicit === 'boolean'
  // 显式选择记录属于会话；新版目录不能把旧版选择误显示为关闭，也不能隐式升级。
  const selected = Boolean(policy.skill_version)
  const enabled = source.enabled && ready && !policy.disabled && (!skill || source.allow_implicit === true || selected)
  return {
    ready,
    enabled,
    needsSelection: skill && source.allow_implicit === false && !selected,
    updateAvailable: skill && enabled && selected && policy.skill_version !== source.version,
  }
}

export function integrationTogglePolicy(source: Source, policy: IntegrationPolicy, enabled: boolean): IntegrationPolicy {
  // 只有用户主动开启时才建立显式选择；关闭和重新开启均保留已有版本。
  return {
    ...policy,
    disabled: !enabled,
    ...(enabled && source.kind === 'skill' && source.allow_implicit === false && !policy.skill_version
      ? { skill_version: source.version } : {}),
  }
}
