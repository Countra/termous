import { BookOpenText, Braces, CircleGauge, PlugZap, ShieldCheck } from 'lucide-react'
import { Progress, Switch } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '#shared/ui'
import type { AgentWorkspaceInspectorState } from '../model/types.ts'
import styles from './AgentInspector.module.scss'

export function AgentInspector({
  inspector,
  disabled,
  onApprovalBypassChange,
}: {
  inspector: AgentWorkspaceInspectorState
  disabled: boolean
  onApprovalBypassChange: (enabled: boolean) => Promise<void>
}) {
  const { t } = useTranslation()
  const [confirmBypass, setConfirmBypass] = useState(false)
  const [saving, setSaving] = useState(false)
  const usage = inspector.context.context_window_tokens > 0
    ? Math.min(100, Math.round(inspector.context.used_tokens / inspector.context.context_window_tokens * 100))
    : 0
  const setPolicy = async (enabled: boolean) => {
    setSaving(true)
    try {
      await onApprovalBypassChange(enabled)
      setConfirmBypass(false)
    } catch {
      // 失败提示由页面统一处理，保留确认窗口便于用户重试。
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside className={styles.inspector} data-agent-panel aria-label={t('agent.inspector.title')}>
      <section className={styles['inspector-section']}>
        <header><CircleGauge size={15} /><h3>{t('agent.inspector.context')}</h3></header>
        <div className={styles['context-usage']}>
          <div><strong>{usage}%</strong><span>{t(inspector.context.estimated ? 'agent.inspector.estimated' : 'agent.inspector.measured')}</span></div>
          <Progress
            percent={usage}
            showInfo={false}
            strokeColor={usage >= inspector.context.warning_threshold * 100 ? 'var(--warning)' : 'var(--accent)'}
            railColor="var(--surface-hover)"
          />
          <p>{formatTokens(inspector.context.used_tokens)} / {formatTokens(inspector.context.context_window_tokens)} token</p>
        </div>
      </section>
      <section className={styles['inspector-section']}>
        <header><BookOpenText size={15} /><h3>{t('agent.inspector.skills')}</h3><span>{inspector.skills.length}</span></header>
        {inspector.skills.length ? (
          <div className={styles['skill-list']}>
            {inspector.skills.map((skill) => <div key={skill.name}><strong>{skill.name}</strong><span>{skill.description}</span></div>)}
          </div>
        ) : <p className={styles['inspector-empty']}>{t('agent.inspector.skillsReady')}</p>}
      </section>
      <section className={styles['inspector-section']}>
        <header><PlugZap size={15} /><h3>{t('agent.inspector.mcp')}</h3><span className={inspector.mcp.connected ? styles['is-connected'] : ''}>{t(inspector.mcp.connected ? 'agent.inspector.connected' : 'agent.inspector.disconnected')}</span></header>
        <div className={styles['mcp-metrics']}>
          <div><Braces size={14} /><strong>{inspector.mcp.tool_count ?? '—'}</strong><span>{t('agent.inspector.tools')}</span></div>
          <div><ShieldCheck size={14} /><strong>{inspector.mcp.scope_count}</strong><span>{t('agent.inspector.scopes')}</span></div>
        </div>
        <div className={styles['approval-policy']}>
          <div><strong>{t('agent.inspector.approval')}</strong><span>{t(inspector.mcp.approval_bypass ? 'agent.inspector.bypassHint' : 'agent.inspector.reviewHint')}</span></div>
          <Switch
            checked={inspector.mcp.approval_bypass}
            loading={saving}
            disabled={disabled || saving}
            aria-label={t('agent.inspector.approval')}
            onChange={(checked) => checked ? setConfirmBypass(true) : void setPolicy(false)}
          />
        </div>
      </section>
      <ConfirmDialog
        open={confirmBypass}
        title={t('agent.inspector.confirmBypassTitle')}
        description={t('agent.inspector.confirmBypassDescription')}
        confirmLabel={t('agent.inspector.confirmBypass')}
        danger
        confirmLoading={saving}
        onCancel={() => setConfirmBypass(false)}
        onConfirm={() => void setPolicy(true)}
      />
    </aside>
  )
}

function formatTokens(value: number) {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(1)}m`
}
