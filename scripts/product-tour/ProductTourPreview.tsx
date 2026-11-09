import { useMemo, useRef, useState } from 'react'
import { App, Button } from 'antd'
import { TermousUiProvider } from '#app/ui-runtime'
import { AgentPage } from '#pages/agent'
import { SettingsDialog } from '#pages/settings'
import { ProductTourGuide, type ProductTourStep } from '#features/product-tour'
import { WorkflowWorkspace } from '#features/desktop-workflows'
import { defaultCompletionSettings, defaultConnectionSettings, defaultTerminalSettings } from '#entities/settings'
import { defaultShortcutSettings, ShortcutRuntime, ShortcutRuntimeContextProvider } from '#entities/shortcuts'
import { createProductTourProgress } from '../../src/features/product-tour/model/productTourProgress'
import { PreviewMcpProvider } from '../settings/PreviewMcpProvider'
import { createTourFixture, unavailable } from './fixture'

const params = new URLSearchParams(location.search)
const fixture = createTourFixture(params.has('unready'), params.has('empty'))
const shortcuts = { runtime: new ShortcutRuntime({ index: { platform: 'win32', byChord: new Map() } }), platform: 'win32' as const, labels: new Map(), bindingSignatures: new Map() }
const values = new Map<string, string>()
const progress = createProductTourProgress(() => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } }))

function Preview() {
  const { message } = App.useApp()
  const [page, setPage] = useState('agent')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [guided, setGuided] = useState(false)
  const [request, setRequest] = useState(1)
  const [intent, setIntent] = useState<{ key: number; workflowView?: 'scripts' | 'runs' }>()
  const sequence = useRef(0)
  const prepare = async (step: ProductTourStep, signal: AbortSignal) => {
    if (signal.aborted || dirty || busy) return false
    setSettingsOpen(step.route === 'settings')
    if (step.route && step.route !== 'settings') setPage(step.route)
    if (step.workflowView) setIntent({ key: ++sequence.current, workflowView: step.workflowView })
    return true
  }
  return <ShortcutRuntimeContextProvider value={shortcuts}><PreviewMcpProvider>
    <div style={{ height: '100dvh', display: 'grid', gridTemplateRows: '44px minmax(0, 1fr)', background: 'var(--app-bg)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', borderBottom: '1px solid var(--border)' }}>
        <strong style={{ color: 'var(--text-primary)', marginRight: 'auto' }}>TERMOUS · 使用向导验收</strong>
        <Button size="small" data-tour="product-tour-trigger" onClick={() => setRequest(value => value + 1)}>使用向导</Button>
      </header>
      <main style={{ minHeight: 0, padding: 16 }}>
        <div hidden={page !== 'agent'} inert={page !== 'agent'} style={{ height: '100%' }}>
          <AgentPage gateway={fixture.agent.gateway} integrationsGateway={fixture.integrations} setupGateway={fixture.agent.setup}
            enabled active={page === 'agent'} guided={guided} sshResourcesReady onOpenSettings={() => setSettingsOpen(true)} />
        </div>
        <div hidden={page !== 'remote-desktop'} inert={page !== 'remote-desktop'} style={{ height: '100%' }} data-tour="desktop-workspace">
          <WorkflowWorkspace gateway={fixture.workflow} sessions={[]} profiles={[]} active={page === 'remote-desktop'} guided={guided} guideView={intent}
            onDirtyChange={() => undefined} onViewDesktop={unavailable} />
        </div>
        {page !== 'agent' && page !== 'remote-desktop' && <section data-tour={`${page}-workspace`} style={{ color: 'var(--text-primary)' }}>{page}</section>}
      </main>
    </div>
    <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} guided={guided} onDirtyChange={setDirty} onBusyChange={setBusy}
      settingsGateway={fixture.settings} integrationsGateway={fixture.integrations} agentSetupGateway={fixture.setup}
      language={params.has('en') ? 'en-US' : 'zh-CN'} appearanceSettings={{ theme: params.has('light') ? 'light' : 'dark' }}
      terminalSettings={defaultTerminalSettings} sshSmoothScrollEnabled={false} completionSettings={defaultCompletionSettings} connectionSettings={defaultConnectionSettings}
      shortcutSettings={defaultShortcutSettings} windowSettings={{ close_behavior: 'exit' }} terminalFonts={[]} appVersion="0.0.0-preview"
      dataPortabilityGateway={fixture.data} auditSettingsGateway={fixture.settings} mountSettingsGateway={fixture.settings} actionBusy={false}
      onLanguageChange={unavailable} onAppearanceSettingsChange={unavailable} onTerminalSettingsChange={unavailable} onSshSmoothScrollChange={() => undefined}
      onCompletionSettingsChange={unavailable} onConnectionSettingsChange={unavailable} onShortcutSettingsChange={unavailable}
      onWindowSettingsChange={unavailable} onUploadTerminalFont={unavailable} onDeleteTerminalFont={unavailable} />
    <ProductTourGuide ready autoStartEligible={false} blocked={dirty || busy} manualRequestKey={request} progress={progress}
      onSessionChange={value => { setGuided(value); if (!value) setIntent(undefined) }} onPrepareStep={prepare} isTransitionBlocked={() => dirty || busy}
      onBlocked={() => { void message.warning('请先完成或取消当前操作') }} onError={() => { void message.error('向导准备失败') }} />
  </PreviewMcpProvider></ShortcutRuntimeContextProvider>
}

export function ProductTourPreview() {
  const appearance = useMemo(() => ({ language: params.has('en') ? 'en-US' as const : 'zh-CN' as const, theme: params.has('light') ? 'light' as const : 'dark' as const }), [])
  return <TermousUiProvider {...appearance}><Preview /></TermousUiProvider>
}
