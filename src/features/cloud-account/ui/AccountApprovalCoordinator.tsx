import { FeedbackMessage, FeedbackMessageScope } from '#shared/ui'
import { useEffect, useRef, useState } from 'react'
import { Button } from 'antd'
import { useTranslation } from 'react-i18next'
import type { CloudAuthorization, CloudAuthorizationTarget, CloudStatus } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { useCloudAccount } from '../model/useCloudAccount'
import { useCloudAuthorization } from '../model/useCloudAuthorization'
import { AccountAuthorization } from './AccountAuthorization'

interface Props {
  api: CloudGateway
  status: CloudStatus
  blocked: boolean
  target?: CloudAuthorizationTarget
  onClose: () => void
}

// 审批对话框常驻应用层入口，不切换页面或卸载草稿；提示只打开详情，不代替用户决定。
export function AccountApprovalCoordinator({ api, status, blocked, target, onClose }: Props) {
  const { t } = useTranslation()
  const { busy, run } = useCloudAccount(api)
  const generation = status.generation
  const authorization = useCloudAuthorization(api, generation)
  const [selected, setSelected] = useState<CloudAuthorization>()
  const [targetError, setTargetError] = useState(false)
  const [retry, setRetry] = useState(0)
  const handled = useRef(new Set<string>())
  useEffect(() => {
    handled.current.clear()
    setSelected(undefined); setTargetError(false)
  }, [api, generation])
  useEffect(() => {
    if (!target || blocked || busy || selected?.id === target.id && selected.kind === target.kind) return
    const controller = new AbortController()
    setSelected(undefined)
    setTargetError(false)
    void api.authorization(generation, target.kind, target.id, controller.signal).then(value => {
      if (!controller.signal.aborted && api.getStatus()?.generation === generation) {
        handled.current.add(value.id)
        setSelected(value)
      }
    }).catch(() => {
      if (!controller.signal.aborted && api.getStatus()?.generation === generation) setTargetError(true)
    })
    return () => controller.abort()
  }, [api, generation, target, blocked, busy, retry, selected])
  useEffect(() => {
    if (blocked || busy || selected || target || status.device_status !== 'active' || !status.authenticated || api.getStatus()?.generation !== generation) return
    const next = authorization.requests.find(value => value.kind === 'approval' && value.status === 'pending'
      && value.device_id !== status.device_id && value.allowed_actions.includes('approve')
      && Date.parse(value.expires_at) > Date.now() && !handled.current.has(value.id))
    if (!next) return
    // 同一申请关闭后不因重连或重复事件再次打断用户，其他申请依次展示。
    handled.current.add(next.id)
    setSelected(next)
  }, [api, authorization.requests, blocked, busy, generation, selected, status.authenticated, status.device_id, status.device_status, target])
  const close = () => { if (!busy) { setSelected(undefined); setTargetError(false); onClose() } }
  return <FeedbackMessageScope scope={generation}>
    {selected ? <AccountAuthorization key={`${generation}:${selected.kind}:${selected.id}`} api={api} generation={generation} value={selected}
      mfaEnabled={authorization.security?.account.mfa_enabled} mfaRevision={authorization.security?.account.mfa_revision} open={!blocked} busy={busy} run={run} onClose={close} onChanged={() => void authorization.reload()} /> : null}
    {!blocked && targetError && !selected ? <FeedbackMessage type="warning" title={t('cloud.authorization.readFailed')} onClose={close}
      action={<Button onClick={() => setRetry(value => value + 1)}>{t('cloud.retry')}</Button>} /> : null}
  </FeedbackMessageScope>
}
