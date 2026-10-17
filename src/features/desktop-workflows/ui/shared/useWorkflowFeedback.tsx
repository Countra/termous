import { App, Button } from 'antd'
import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkflowSurfaceModel } from '../../model/workspace/types'
import { workflowError } from '../../model/messages'
import { findStep } from '../../model/steps'
import styles from './WorkflowFeedback.module.scss'

export function useWorkflowFeedback(model: WorkflowSurfaceModel) {
  const { message } = App.useApp()
  const { t } = useTranslation()
  const scope = useId()
  const activeKey = useRef<string | undefined>(undefined)
  const current = useRef(model); current.current = model
  const seen = useRef<string | undefined>(undefined)
  const dataError = useRef<string | undefined>(undefined)
  const { notice } = model.state
  useEffect(() => {
    if (!notice || seen.current === notice.id) return
    seen.current = notice.id
    if (activeKey.current) message.destroy(activeKey.current)
    // 每次操作创建独立消息，避免复用计时器导致常驻诊断继承上次成功提示的自动关闭。
    const key = `${scope}:${notice.id}`
    activeKey.current = key
    if (notice.kind === 'error') {
      void message.error({ key, content: workflowError(notice.error, t), duration: 6 })
    } else if (!notice.diagnostics.length) {
      void message.success({ key, content: t('desktopWorkflow.validationPassed'), duration: 4 })
    } else {
      void message.warning({ key, duration: 0, styles: { icon: { alignSelf: 'flex-start', marginBlockStart: 7 } }, content: <div className={styles.validation}>
        <div className={styles.heading}><strong>{t('desktopWorkflow.validationFailed')}</strong>
          <Button type="text" size="small" icon={<X size={13} />} aria-label={t('desktopWorkflow.closeValidation')} onClick={() => message.destroy(key)} />
        </div>
        <div className={styles.items}>{notice.diagnostics.map((item, i) => {
          const label = findStep(current.current.state.draft?.definition.steps ?? [], item.step_id)?.name
            || (['steps', 'parameters'].includes(item.field) ? t(`desktopWorkflow.${item.field}`) : item.field)
          const content = <><span>{label}</span>{t(`desktopWorkflow.diagnostics.${item.code}`, { defaultValue: item.code })}</>
          return item.step_id ? <button className={styles.item} type="button" key={i} onClick={() => {
            // 提示可停留至用户关闭；过期的诊断不能选中另一份草稿或已删除的步骤。
            const draft = current.current.state.draft
            if (draft?.editingID !== notice.editor || !findStep(draft.definition.steps, item.step_id)) { message.destroy(key); return }
            current.current.actions.view('scripts'); current.current.actions.selectStep(item.step_id)
          }}>{content}</button> : <div className={styles.item} key={i}>{content}</div>
        })}</div>
      </div> })
    }
    // 标识式确认可避免迟到的消费请求清除下一次操作结果，也不会在跨窗口时重放旧消息。
    model.actions.dismissNotice(notice.id)
  }, [scope, message, model.actions, notice, t])
  useEffect(() => {
    const error = model.dataError
    const fingerprint = error && JSON.stringify([error.code, error.status, error.message])
    if (fingerprint && fingerprint !== dataError.current) void message.error({ key: `${scope}:data`, content: workflowError(error, t), duration: 6 })
    dataError.current = fingerprint
  }, [scope, message, model.dataError, t])
  useEffect(() => () => { if (activeKey.current) message.destroy(activeKey.current); message.destroy(`${scope}:data`) }, [scope, message])
}
