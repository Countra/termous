import { Input, InputNumber, Modal, Segmented, Switch } from 'antd'
import type { FirewallRuleAction, FirewallRuleInput, FirewallRuleProtocol } from '#entities/firewall'
import {
  firewallActions,
  firewallProtocols,
  normalizePorts,
  validateFirewallRuleInput,
} from '../model/firewallUtils'
import styles from './FirewallPanel.module.scss'

interface FirewallRuleModalProps {
  open: boolean
  title: string
  value: FirewallRuleInput
  busy: boolean
  t: (key: string) => string
  onChange: (value: FirewallRuleInput) => void
  onCancel: () => void
  onSubmit: () => void
}

export function FirewallRuleModal({
  open,
  title,
  value,
  busy,
  t,
  onChange,
  onCancel,
  onSubmit,
}: FirewallRuleModalProps) {
  const error = validateFirewallRuleInput(value, t)
  const port = value.ports[0] ?? { from: 80, to: 80 }

  const update = (patch: Partial<FirewallRuleInput>) => {
    onChange({ ...value, ...patch })
  }

  const updateProtocol = (protocol: FirewallRuleProtocol) => {
    update({ protocol, ports: normalizePorts(protocol, value.ports) })
  }

  return (
    <Modal
      open={open}
      centered
      destroyOnHidden
      className={`termous-modal ${styles['firewall-rule-modal']}`}
      rootClassName={styles['firewall-rule-modal-root']}
      title={title}
      okText={t('workbench.firewall.editor.save')}
      cancelText={t('app.cancel')}
      confirmLoading={busy}
      okButtonProps={{ disabled: Boolean(error) }}
      onCancel={onCancel}
      onOk={onSubmit}
    >
      <div className={styles['firewall-rule-form']}>
        <label className={styles['firewall-field']}>
          <span>{t('workbench.firewall.fields.action')}</span>
          <Segmented
            block
            value={value.action}
            options={firewallActions.map((action) => ({ label: t(`workbench.firewall.action.${action}`), value: action }))}
            onChange={(next) => update({ action: next as FirewallRuleAction })}
          />
        </label>
        <label className={styles['firewall-field']}>
          <span>{t('workbench.firewall.fields.protocol')}</span>
          <Segmented
            block
            value={value.protocol}
            options={firewallProtocols.map((protocol) => ({ label: t(`workbench.firewall.protocol.${protocol}`), value: protocol }))}
            onChange={(next) => updateProtocol(next as FirewallRuleProtocol)}
          />
        </label>
        <label className={styles['firewall-field']}>
          <span>{t('workbench.firewall.fields.source')}</span>
          <Input
            id="firewall-rule-source"
            name="firewall-rule-source"
            value={value.source}
            placeholder="0.0.0.0/0"
            onChange={(event) => update({ source: event.target.value })}
          />
        </label>
        {value.protocol === 'tcp' || value.protocol === 'udp' ? (
          <div className={styles['firewall-port-grid']}>
            <label className={styles['firewall-field']}>
              <span>{t('workbench.firewall.fields.portFrom')}</span>
              <InputNumber
                id="firewall-rule-port-from"
                name="firewall-rule-port-from"
                min={1}
                max={65535}
                value={port.from}
                onChange={(next) => update({ ports: [{ from: Number(next || 0), to: Math.max(Number(next || 0), port.to) }] })}
              />
            </label>
            <label className={styles['firewall-field']}>
              <span>{t('workbench.firewall.fields.portTo')}</span>
              <InputNumber
                id="firewall-rule-port-to"
                name="firewall-rule-port-to"
                min={1}
                max={65535}
                value={port.to}
                onChange={(next) => update({ ports: [{ from: port.from, to: Number(next || 0) }] })}
              />
            </label>
          </div>
        ) : null}
        <label className={styles['firewall-field']}>
          <span>{t('workbench.firewall.fields.description')}</span>
          <Input
            id="firewall-rule-description"
            name="firewall-rule-description"
            value={value.description}
            maxLength={120}
            placeholder={t('workbench.firewall.editor.descriptionPlaceholder')}
            onChange={(event) => update({ description: event.target.value })}
          />
        </label>
        <div className={styles['firewall-switch-line']}>
          <span>{t('workbench.firewall.fields.enabled')}</span>
          <Switch checked={value.enabled} onChange={(checked) => update({ enabled: checked })} />
        </div>
        {error ? <p className={styles['firewall-form-error']}>{error}</p> : null}
      </div>
    </Modal>
  )
}
