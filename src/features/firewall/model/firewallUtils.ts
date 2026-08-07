import type {
  FirewallPortRange,
  FirewallRule,
  FirewallRuleAction,
  FirewallRuleInput,
  FirewallRuleProtocol,
} from '#entities/firewall'

export const firewallActions: FirewallRuleAction[] = ['allow', 'drop', 'reject']

export const firewallProtocols: FirewallRuleProtocol[] = ['tcp', 'udp', 'icmp', 'any']

export function createFirewallRuleInput(): FirewallRuleInput {
  return {
    direction: 'inbound',
    family: 'ipv4',
    action: 'allow',
    protocol: 'tcp',
    source: '0.0.0.0/0',
    ports: [{ from: 80, to: 80 }],
    description: '',
    enabled: true,
  }
}

export function firewallRuleToInput(rule: FirewallRule): FirewallRuleInput {
  return {
    id: rule.id,
    raw_ref: rule.raw_ref,
    direction: rule.direction,
    family: rule.family,
    action: rule.action,
    protocol: rule.protocol,
    source: rule.source || '0.0.0.0/0',
    ports: normalizePorts(rule.protocol, rule.ports ?? []),
    description: rule.description ?? '',
    enabled: rule.enabled,
  }
}

export function normalizePorts(protocol: FirewallRuleProtocol, ports: FirewallPortRange[]) {
  if (protocol !== 'tcp' && protocol !== 'udp') {
    return []
  }
  if (ports.length === 0) {
    return [{ from: 80, to: 80 }]
  }
  return ports.map((port) => ({
    from: Number(port.from),
    to: Number(port.to || port.from),
  }))
}

export function formatFirewallPorts(protocol: FirewallRuleProtocol, ports: FirewallPortRange[] = []) {
  if (protocol === 'any' || protocol === 'icmp') {
    return 'Any'
  }
  if (ports.length === 0) {
    return 'Any'
  }
  return ports.map((port) => (port.from === port.to ? String(port.from) : `${port.from}-${port.to}`)).join(', ')
}

export function formatFirewallSource(source?: string) {
  return source && source.trim() ? source : '0.0.0.0/0'
}

export function validateFirewallRuleInput(rule: FirewallRuleInput, t: (key: string) => string) {
  const source = rule.source.trim()
  if (!source) {
    return t('workbench.firewall.validation.source')
  }
  if ((rule.protocol === 'tcp' || rule.protocol === 'udp') && rule.ports.length === 0) {
    return t('workbench.firewall.validation.port')
  }
  for (const port of rule.ports) {
    if (!validPort(port.from) || !validPort(port.to) || port.from > port.to) {
      return t('workbench.firewall.validation.port')
    }
  }
  if (rule.description.length > 120) {
    return t('workbench.firewall.validation.description')
  }
  return ''
}

export function compactFirewallRuleInput(rule: FirewallRuleInput): FirewallRuleInput {
  return {
    ...rule,
    source: rule.source.trim() || '0.0.0.0/0',
    description: rule.description.trim(),
    ports: normalizePorts(rule.protocol, rule.ports),
  }
}

export function firewallActionTone(action: FirewallRuleAction) {
  if (action === 'allow') {
    return 'is-allow'
  }
  if (action === 'reject') {
    return 'is-reject'
  }
  return 'is-drop'
}

function validPort(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 65535
}
