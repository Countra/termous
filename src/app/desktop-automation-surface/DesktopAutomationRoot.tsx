import { useEffect, useState } from 'react'
import { Alert, Spin } from 'antd'
import { useTranslation } from 'react-i18next'
import type { DesktopAutomationBootstrap } from '#common/contracts'
import { getDesktopAutomationBridge } from '#shared/bridge'
import { HostedVncViewer } from '#features/remote-desktop'
import { TermousUiProvider } from '#app/ui-runtime'

export default function DesktopAutomationRoot() {
  const { t } = useTranslation()
  const bridge = getDesktopAutomationBridge()
  const [bootstrap, setBootstrap] = useState<DesktopAutomationBootstrap>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    if (!bridge) { setFailed(true); return }
    void bridge.bootstrap().then(value => { if (active) setBootstrap(value) }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [bridge])
  return <TermousUiProvider language={bootstrap?.language ?? 'zh-CN'} theme={bootstrap?.theme ?? 'dark'}>
    {failed ? <Alert type="error" title={t('remoteDesktop.automation.hostFailed')} /> : bootstrap && bridge ? <HostedVncViewer bootstrap={bootstrap} bridge={bridge} /> : <Spin fullscreen />}
  </TermousUiProvider>
}
