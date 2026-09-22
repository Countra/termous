import { Alert, Button, Checkbox, Modal, Tag, Tooltip } from 'antd'
import { Download, FolderOpen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkillInstallClient, SkillInstallError, SkillInstallPlan, SkillInstallResult } from '#common/contracts'
import { CustomSelect } from '#shared/ui'
import { getSkillInstallGateway } from '../../api/skillInstallGateway'
import styles from './McpSkillInstallButton.module.scss'

export function McpSkillInstallButton() {
  const { t } = useTranslation()
  const gateway = getSkillInstallGateway()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Tooltip title={gateway ? undefined : t('settings.mcp.skills.desktopOnly')}>
        <span>
          <Button icon={<Download size={15} />} disabled={!gateway} onClick={() => setOpen(true)}>
            {t('settings.mcp.skills.install')}
          </Button>
        </span>
      </Tooltip>
      {open && gateway ? <SkillInstallDialog gateway={gateway} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function SkillInstallDialog({ gateway, onClose }: {
  gateway: NonNullable<ReturnType<typeof getSkillInstallGateway>>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [client, setClient] = useState<SkillInstallClient>('codex')
  const [plan, setPlan] = useState<SkillInstallPlan | null>(null)
  const [result, setResult] = useState<SkillInstallResult | null>(null)
  const [destination, setDestination] = useState('')
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState<'select' | 'install' | null>(null)
  const [error, setError] = useState<SkillInstallError | null>(null)
  const busyRef = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const choose = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy('select')
    setError(null)
    try {
      const response = await gateway.selectDirectory(client)
      if (!mounted.current) return
      if (!response.ok) {
        setPlan(null); setResult(null); setDestination(''); setError(response.error)
        return
      }
      if (response.value) {
        setPlan(response.value); setDestination(response.value.target_directory); setResult(null); setReplace(false)
      }
    } catch {
      if (mounted.current) { setPlan(null); setResult(null); setDestination(''); setError('io_error') }
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(null)
    }
  }
  const install = async () => {
    if (busyRef.current || !plan) return
    busyRef.current = true
    setBusy('install')
    setError(null)
    try {
      const response = await gateway.install({ plan_id: plan.id, policy: replace ? 'replace' : 'skip' })
      if (!mounted.current) return
      if (response.ok) setResult(response.value)
      else setError(response.error)
    } catch { if (mounted.current) setError('io_error') } finally {
      busyRef.current = false
      if (mounted.current) { setPlan(null); setBusy(null) }
    }
  }
  const conflicts = plan?.skills.filter((skill) => skill.exists).length ?? 0
  const issues = result?.items.some((item) => item.status === 'failed' || item.error)
  const installed = result?.items.filter((item) => item.status === 'installed').length ?? 0
  const skipped = result?.items.filter((item) => item.status === 'skipped').length ?? 0
  return (
    <Modal open centered width={620} rootClassName={styles.modal}
      title={<div className={styles.title}>
        <span aria-hidden="true"><Download size={18} /></span>
        <strong>{t('settings.mcp.skills.install')}</strong>
      </div>}
      onCancel={onClose} closable={!busy} keyboard={!busy} mask={{ closable: !busy }}
      footer={[
        <Button key="close" onClick={onClose} disabled={Boolean(busy)}>{t(result ? 'app.close' : 'app.cancel')}</Button>,
        <Button key="install" type="primary" icon={<Download size={15} />} loading={busy === 'install'}
          disabled={!plan || Boolean(busy)} onClick={() => void install()}>{t('settings.mcp.skills.install')}</Button>,
      ]}>
      <div className={styles.body}>
        <p className={styles.hint}>{t('settings.mcp.skills.hint')}</p>
        <CustomSelect label={t('settings.mcp.skills.client')} value={client} disabled={Boolean(busy)}
          options={[
            { value: 'codex', label: 'Codex', description: '.agents/skills' },
            { value: 'claude-code', label: 'Claude Code', description: '.claude/skills' },
            { value: 'custom', label: t('settings.mcp.skills.custom'), description: t('settings.mcp.skills.customHint') },
          ]} onChange={(value) => {
            setClient(value as SkillInstallClient); setPlan(null); setResult(null); setDestination(''); setError(null); setReplace(false)
          }} />
        <div className={styles.directory}>
          <div><strong>{t('settings.mcp.skills.directory')}</strong><p>{t(`settings.mcp.skills.directoryHint.${client}`)}</p></div>
          <Button icon={<FolderOpen size={15} />} loading={busy === 'select'} disabled={Boolean(busy)} onClick={() => void choose()}>
            {t('settings.mcp.skills.choose')}
          </Button>
        </div>
        {destination ? <div className={styles.destination}>
          <span>{t('settings.mcp.skills.destination')}</span>
          <code>{destination}</code>
        </div> : null}
        {plan ? <>
          <ul className={styles.skills} aria-label={t('settings.mcp.skills.contents')}>
            {plan.skills.map((skill) => <li key={skill.name}><code>{skill.name}</code>
              <Tag>{t(skill.exists ? 'settings.mcp.skills.exists' : 'settings.mcp.skills.new')}</Tag>
            </li>)}
          </ul>
          {conflicts > 0 ? <div className={styles.conflict}>
            <Checkbox checked={replace} disabled={Boolean(busy)} onChange={(event) => setReplace(event.target.checked)}>
              {t('settings.mcp.skills.replace', { count: conflicts })}
            </Checkbox>
            <p>{t(replace ? 'settings.mcp.skills.replaceHint' : 'settings.mcp.skills.skipHint')}</p>
          </div> : null}
        </> : null}
        {error ? <Alert type="error" showIcon title={t('settings.mcp.skills.failed')} description={t(`settings.mcp.skills.errors.${error}`)} /> : null}
        {result ? <div role="status" className={styles.result}>
          <Alert type={issues ? 'warning' : 'success'} showIcon
            title={t(issues ? 'settings.mcp.skills.partial' : 'settings.mcp.skills.finished')}
            description={t('settings.mcp.skills.summary', { installed, skipped, failed: result.items.filter((item) => item.status === 'failed').length })} />
          <ul className={styles.skills}>
            {result.items.map((item) => <li key={item.name} className={styles['result-item']}>
              <div><code>{item.name}</code><Tag>{t(`settings.mcp.skills.status.${item.status}`)}</Tag></div>
              {item.error ? <p>{t(`settings.mcp.skills.errors.${item.error}`)}</p> : null}
              {item.recovery_path ? <p>{t('settings.mcp.skills.recovery')}<code>{item.recovery_path}</code></p> : null}
            </li>)}
          </ul>
          <p className={styles.hint}>{t('settings.mcp.skills.afterInstall')}</p>
        </div> : null}
      </div>
    </Modal>
  )
}
