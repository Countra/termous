import assert from 'node:assert/strict'
import test from 'node:test'
import type { FirewallRule } from '#entities/firewall'
import {
  compactFirewallRuleInput,
  createFirewallRuleInput,
  firewallActionTone,
  firewallRuleToInput,
  formatFirewallPorts,
  normalizePorts,
  validateFirewallRuleInput,
} from './firewallUtils.ts'

const translate = (key: string) => key

test('防火墙规则草稿保持默认值、端口归一化与展示语义', () => {
  assert.deepEqual(createFirewallRuleInput(), {
    direction: 'inbound',
    family: 'ipv4',
    action: 'allow',
    protocol: 'tcp',
    source: '0.0.0.0/0',
    ports: [{ from: 80, to: 80 }],
    description: '',
    enabled: true,
  })
  assert.deepEqual(normalizePorts('icmp', [{ from: 1, to: 2 }]), [])
  assert.deepEqual(normalizePorts('tcp', []), [{ from: 80, to: 80 }])
  assert.deepEqual(normalizePorts('udp', [{ from: 53, to: 0 }]), [{ from: 53, to: 53 }])
  assert.equal(formatFirewallPorts('tcp', [{ from: 80, to: 80 }, { from: 443, to: 444 }]), '80, 443-444')
})

test('防火墙规则校验与提交前压缩保持现有边界', () => {
  const draft = createFirewallRuleInput()
  assert.equal(validateFirewallRuleInput({ ...draft, source: ' ' }, translate), 'workbench.firewall.validation.source')
  assert.equal(validateFirewallRuleInput({ ...draft, ports: [] }, translate), 'workbench.firewall.validation.port')
  assert.equal(
    validateFirewallRuleInput({ ...draft, ports: [{ from: 100, to: 99 }] }, translate),
    'workbench.firewall.validation.port',
  )
  assert.equal(
    validateFirewallRuleInput({ ...draft, description: 'x'.repeat(121) }, translate),
    'workbench.firewall.validation.description',
  )
  assert.deepEqual(compactFirewallRuleInput({
    ...draft,
    source: ' 10.0.0.0/8 ',
    description: ' internal ',
  }), {
    ...draft,
    source: '10.0.0.0/8',
    description: 'internal',
  })
})

test('服务端防火墙规则转换保留标识并补齐可编辑默认值', () => {
  const rule = {
    id: 'rule-1',
    raw_ref: 'raw-1',
    provider: 'nftables',
    direction: 'inbound',
    family: 'ipv4',
    action: 'reject',
    protocol: 'tcp',
    enabled: true,
    managed: true,
    editable: true,
  } as FirewallRule

  assert.deepEqual(firewallRuleToInput(rule), {
    id: 'rule-1',
    raw_ref: 'raw-1',
    direction: 'inbound',
    family: 'ipv4',
    action: 'reject',
    protocol: 'tcp',
    source: '0.0.0.0/0',
    ports: [{ from: 80, to: 80 }],
    description: '',
    enabled: true,
  })
  assert.equal(firewallActionTone('allow'), 'is-allow')
  assert.equal(firewallActionTone('reject'), 'is-reject')
  assert.equal(firewallActionTone('drop'), 'is-drop')
})
