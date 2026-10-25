import React, { useState } from 'react'
import { Button, ConfigProvider, Space, Switch } from 'antd'
import { MonitorPlay } from 'lucide-react'
import zhCN from 'antd/locale/zh_CN'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { PresentationController, presentationDefaults, presentationPreset, type PresentationState } from '@termous/remote-protocol/presentation'
import { DesktopPresentationControls } from '../../src/entities/remote-desktop/ui/DesktopPresentationControls'
import { SettingsGatewayContext, SettingsModuleStore, type SettingsGateway } from '../../src/entities/settings'
import type { SettingsSnapshot } from '../../common/contracts'
import { PresentationDefaultsSettings } from '../../src/features/settings/ui/remote-desktop/PresentationDefaultsSettings'
import { SettingsField, SettingsGroup } from '../../src/features/settings/ui/controls/SettingsGroup'
import { createAntdTheme } from '../../src/shared/theme'
import 'antd/dist/reset.css'
import '../../src/shared/styles/global.scss'

await i18n.use(initReactI18next).init({ lng: 'zh', resources: {}, interpolation: { escapeValue: false } })

export function Fixture({ kind }: { kind: 'pixels' | 'video' | 'rfb' }) {
  const [state, setState] = useState<PresentationState>(() => ({ capabilities: { kind, available: true, dynamicSize: true, maxWidth: 1920, maxHeight: 1080, maxBitrate: 8_000_000, maxFramerate: 30 }, requested: presentationPreset(kind, 'clear'), revision: 0n, configRevision: 0n, status: kind === 'rfb' ? 'preference_sent' : 'confirmed' }))
  const [scale, setScale] = useState<'fit' | 'actual'>('fit')
  const [size, setSize] = useState('1920 × 1080')
  const [initial] = useState(state)
  const [controller] = useState(() => {
    const controller = new PresentationController({ configure: async (settings, _id, revision) => ({ ...initial, requested: settings, revision: revision + 1n, status: settings.kind === 'rfb' ? 'preference_sent' : 'confirmed' }) }, setState)
    return controller
  })
  React.useEffect(() => { controller.update(initial); return () => controller.dispose() }, [controller, initial])
  return <>
    <DesktopPresentationControls state={state} onChange={value => controller.set(value)} scale={scale} onScale={setScale} resizeAvailable onResize={(width, height) => setSize(`${width} × ${height}`)} />
    <details><summary>本次测试参数</summary><pre aria-label="已提交参数">{JSON.stringify({ settings: state.requested, status: state.status, scale, target: size }, null, 2)}</pre></details>
  </>
}

export function App() {
  const [kind, setKind] = useState<'pixels' | 'video' | 'rfb'>('pixels')
  const [mode, setMode] = useState<'light' | 'dark'>('dark')
  const [narrow, setNarrow] = useState(false)
  const [failure, setFailure] = useState(false)
  const failSave = React.useRef(false)
  failSave.current = failure
  const [gateway] = useState<SettingsGateway>(() => {
    let snapshot: SettingsSnapshot = { id: 'desktop_presentation', schema_version: 1, revision: 1, value: { ...presentationDefaults() }, state: { status: 'saved' } }
    const store = new SettingsModuleStore({
      read: async () => snapshot,
      update: async (_id, input) => {
        if (failSave.current) throw new Error('preview_save_failed')
        snapshot = { ...snapshot, revision: snapshot.revision + 1, value: input.patch }
        return snapshot
      },
    })
    return { getModule: id => store.snapshot(id), readModule: (id, signal) => store.read(id, signal), updateModule: (id, patch, options) => store.update(id, patch, options), subscribeSettings: store.subscribe }
  })
  React.useEffect(() => { document.documentElement.dataset.theme = mode; document.body.dataset.termousMainSurface = 'true' }, [mode])
  return <ConfigProvider theme={createAntdTheme(mode)} locale={zhCN}><SettingsGatewayContext value={gateway}>
    <div style={{ height: '100dvh', overflow: 'auto', background: 'var(--surface)' }}>
      <main style={{ padding: '24px 16px', maxWidth: narrow ? 380 : 820, margin: 'auto' }}>
        <h1 style={{ fontSize: 17, margin: '0 0 6px' }}>远程桌面</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>设置页与会话弹窗预览 · 使用内存数据，不连接远端</p>
        <Space wrap>
          <Button onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}>切换主题</Button>
          <Button onClick={() => setNarrow(!narrow)}>切换窄屏</Button>
          <Button onClick={() => setFailure(!failure)}>{failure ? '恢复保存' : '模拟保存失败'}</Button>
          <Button onClick={() => void i18n.changeLanguage(i18n.language === 'zh' ? 'en' : 'zh')}>切换语言</Button>
        </Space>
        <PresentationDefaultsSettings />
        <SettingsGroup title="RDP 连接" icon={<MonitorPlay size={16} />}>
          <SettingsField label="自动重连" htmlFor="preview-reconnect" description="连接中断后自动尝试重连。" descriptionId="preview-reconnect-hint" control={<Switch id="preview-reconnect" defaultChecked aria-describedby="preview-reconnect-hint" />} />
        </SettingsGroup>
        <section style={{ marginTop: 24 }} aria-label="会话预览">
          <Space wrap><Button onClick={() => setKind('pixels')}>本机 RDP</Button><Button onClick={() => setKind('video')}>远控 RDP</Button><Button onClick={() => setKind('rfb')}>VNC</Button><Fixture key={kind} kind={kind} /></Space>
        </section>
      </main>
    </div>
  </SettingsGatewayContext></ConfigProvider>
}
