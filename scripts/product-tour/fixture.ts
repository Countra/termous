import { presentationDefaults } from '@termous/remote-protocol/presentation'
import type { SettingsModuleId, SettingsSnapshot } from '#common/contracts'
import { SettingsModuleStore } from '#entities/settings'
import type { WorkflowGateway } from '#entities/desktop-workflow'
import type { AgentSetupGateway } from '#features/agent-setup'
import type { DataPortabilityGateway } from '#features/settings'
import { createDetachedFixture } from '../agent/detachedFixture'
import { readinessFixture } from '../agent/detachedFixtureData'
import { createModelServiceFixture } from '../settings/modelServiceFixture'

// 所有读写都停留在内存；未提供的操作明确拒绝，不能落到真实 Core 或外部服务。
export async function unavailable(): Promise<never> { throw new Error('向导验收不执行业务操作') }

export function createTourFixture(unready: boolean, empty: boolean) {
  const agent = createDetachedFixture(unready ? 'missing' : 'ready')
  const setup: AgentSetupGateway = {
    ...agent.setup,
    settings: async () => (await agent.setup.readiness()).settings,
    ...createModelServiceFixture(() => ({ ...readinessFixture().settings, default_model_id: 'model-0' }), false),
    updateSettings: unavailable, updateMcpPolicy: unavailable,
  }
  const snapshots = new Map<SettingsModuleId, SettingsSnapshot>([
    ['web_search', { id: 'web_search', schema_version: 1, revision: 1, value: { mode: 'cloud', base_url: '' }, state: { status: 'saved' } }],
    ['local_network', { id: 'local_network', schema_version: 1, revision: 1, value: { enabled: false, url: '', bypass: ['localhost', '127.0.0.1', '::1'] }, state: { status: 'saved' } }],
    ['mcp_integrations', { id: 'mcp_integrations', schema_version: 1, revision: 1, value: { install_root: '', install_timeout_seconds: 1800, startup_timeout_seconds: 120 }, state: { status: 'saved' } }],
    ['desktop_presentation', { id: 'desktop_presentation', schema_version: 1, revision: 1, value: { ...presentationDefaults() }, state: { status: 'saved' } }],
    ['desktop_clipboard', { id: 'desktop_clipboard', schema_version: 1, revision: 1, value: { enabled: false }, state: { status: 'applied' } }],
    ['audit', { id: 'audit', schema_version: 1, revision: 1, value: { enabled: true, retention_days: 90, max_records: 0 }, state: { status: 'applied' } }],
  ])
  const store = new SettingsModuleStore({ read: async id => {
    const value = snapshots.get(id)
    if (!value) throw new Error('向导验收未提供该设置')
    return structuredClone(value)
  }, update: unavailable })
  const settings = { getModule: store.snapshot.bind(store), readModule: store.read.bind(store), updateModule: store.update.bind(store), subscribeSettings: store.subscribe, testWebSearch: unavailable }
  const workflow: WorkflowGateway = {
    list: async () => [], listRuns: async () => [], ocrDefaults: async () => ({ text_confidence: .5, ocr_max_side: 1600 }),
    get: unavailable, save: unavailable, remove: unavailable, versions: unavailable, restore: unavailable, validate: unavailable,
    upload: unavailable, asset: unavailable, openPreview: unavailable, closePreview: unavailable, capture: unavailable, match: unavailable,
    previewOCR: unavailable, ocrReport: unavailable, validateAnalysisAction: unavailable, analysisFull: unavailable, renderAnalysisImage: unavailable,
    submitAnalysis: unavailable, getAnalysis: unavailable, listAnalyses: unavailable, cancelAnalysis: unavailable, clearAnalyses: unavailable,
    analysisElements: unavailable, analysisElement: unavailable, analysisSpans: unavailable, analysisSpan: unavailable, analysisGeometry: unavailable,
    analysisDiagnostics: unavailable, exportAnalysis: unavailable, analysisStorage: unavailable, analysisImage: unavailable, deleteAnalysis: unavailable,
    run: unavailable, start: unavailable, control: unavailable, eventsURL: () => 'ws://127.0.0.1:1/tour-fixture',
  }
  const data: DataPortabilityGateway = { dataPortabilitySummary: async () => ({ total_items: 0, asset_count: 0, asset_bytes: 0, datasets: [] }),
    createDataPortabilityPlan: unavailable, dataPortabilityPlanItems: unavailable, resolveDataPortabilityPlan: unavailable,
    applyDataPortabilityPlan: unavailable, cancelDataPortabilityImport: unavailable }
  return { agent, setup, settings, workflow, data, integrations: empty ? { ...agent.integrations, sources: async () => [] } : agent.integrations }
}
