import { Alert, Button, Form, Input, Modal, Space } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DesktopAutomationBootstrap, DesktopAutomationBridge } from '#common/contracts'
import { VncViewerAdapter, type VncCredentials, type VncCredentialType } from '../runtime/protocols/vnc/noVncAdapter.ts'
import { AutomationPointerState } from '../runtime/core/automationPointerState.ts'
import styles from './HostedVncViewer.module.scss'

export function HostedVncViewer({ bootstrap, bridge }: { bootstrap: DesktopAutomationBootstrap; bridge: DesktopAutomationBridge }) {
  const { t } = useTranslation()
  const target = useRef<HTMLDivElement>(null)
  const adapter = useRef<VncViewerAdapter | null>(null)
  const [failure, setFailure] = useState(false)
  const [fields, setFields] = useState<VncCredentialType[]>([])
  const [verification, setVerification] = useState<{ type: string; fingerprint: string } | null>(null)
  const [form] = Form.useForm<VncCredentials>()
  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    let savedAttempted = false
    let current: VncViewerAdapter | null = null
    const pointer = new AutomationPointerState(bootstrap.host.session_id, bootstrap.host.generation)
    const stopPointer = bridge.onPointer?.(event => { if (!disposed) pointer.publish(event) })
    // 先订阅再读取，版本水位负责去除初始化期间的乱序；显示失败不影响执行宿主。
    void bridge.pointer?.().then(event => { if (!disposed && event) pointer.publish(event, false) }).catch(() => { /* 初始投影不可用时等待后续视觉事件，不影响执行。 */ })
    const fail = () => {
      if (disposed) return
      setFailure(true)
      void bridge.state('failed').catch(() => { if (!disposed) setFailure(true) })
    }
    const prompt = (types: VncCredentialType[]) => {
      if (disposed) return
      setFields(types)
      void bridge.state('waiting_user_action').catch(fail)
    }
    if (!target.current) return
    void VncViewerAdapter.create({
      signal: controller.signal,
      pointer,
      target: target.current, url: bootstrap.streamURL, shared: bootstrap.shared, viewOnly: true, displayMode: 'fit', awaitFirstFrame: true,
      generation: bootstrap.host.generation,
      execution: { connect: () => bridge.executor(), reclaim: async () => { throw new Error('desktop_control_locked') } },
      events: {
        onConnected: () => { if (!disposed) { setFields([]); setVerification(null) } },
        onDisconnected: fail,
        onCredentialsRequired: types => {
          if (!savedAttempted && bootstrap.credentialAvailable && types.every(type => type === 'password')) {
            savedAttempted = true
            void bridge.credentials().then(value => { if (!disposed) current?.sendCredentials(value) }).catch(() => prompt(types))
          } else prompt(types)
        },
        onServerVerification: value => { if (!disposed) { setVerification(value); void bridge.state('waiting_user_action').catch(fail) } },
        onSecurityFailure: fail,
        // 托管观看不连接本机系统剪贴板；目标文本仅由显式 MCP 工具设置。
        onClipboard: () => {}, onDesktopName: () => {}, onCapabilities: () => {}, onMetrics: () => {},
      },
    }).then(value => { current = value; if (disposed) value.dispose(); else adapter.current = value }).catch(fail)
    return () => { disposed = true; stopPointer?.(); pointer.suspend(); controller.abort(); current?.dispose(); adapter.current = null }
  }, [bootstrap, bridge])
  return <main className={styles.host}>
    <header className={styles.header}><strong>{bootstrap.host.name}</strong><span>{t('remoteDesktop.automation.hostHint')}</span></header>
    {failure && <Alert type="error" title={t('remoteDesktop.automation.hostFailed')} />}
    <div ref={target} className={styles.viewport} aria-label={t('remoteDesktop.automation.view')} />
    <Modal open={fields.length > 0} title={t('remoteDesktop.automation.credentials')} onCancel={() => { setFields([]); adapter.current?.disconnect() }} onOk={() => form.submit()} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={values => { adapter.current?.sendCredentials(values); setFields([]); form.resetFields() }}>
        {fields.map(field => <Form.Item key={field} name={field} label={field} rules={[{ required: true }]}>{field === 'password' ? <Input.Password autoComplete="off" /> : <Input autoComplete="off" />}</Form.Item>)}
      </Form>
    </Modal>
    <Modal open={!!verification} title={t('remoteDesktop.automation.verify')} footer={<Space><Button onClick={() => { setVerification(null); adapter.current?.disconnect() }}>{t('app.cancel')}</Button><Button type="primary" onClick={() => { adapter.current?.approveServer(); setVerification(null) }}>{t('remoteDesktop.automation.trustOnce')}</Button></Space>} onCancel={() => { setVerification(null); adapter.current?.disconnect() }}>
      <p>{verification?.type}</p><code>{verification?.fingerprint}</code>
    </Modal>
  </main>
}
