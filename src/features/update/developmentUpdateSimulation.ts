import type { TermousUpdateWindowBridge } from '../../../electron/update-preload'
import type {
  UpdatePhase,
  UpdateSnapshot,
} from '../../../electron/updateTypes'
import type {
  UpdateWindowBootstrap,
} from '../../../electron/updateWindow'
import type { AppBuildInfo } from '../../types/domain'
import type { UpdateRuntimeBridge } from './useUpdateRuntime'
import {
  connectDevelopmentUpdateSimulationChannel,
  type DevelopmentUpdateSimulationAction,
  type DevelopmentUpdateSimulationChannel,
  isDevelopmentUpdateSimulationIdentity,
} from './developmentUpdateSimulationChannel.ts'
import {
  readDevelopmentUpdateLanguage,
  readDevelopmentUpdatePlatform,
  readDevelopmentUpdateTheme,
} from './developmentUpdateSimulationEnvironment.ts'
import {
  createDevelopmentUpdateSimulationStore,
  type DevelopmentUpdateSimulationStore,
} from './developmentUpdateSimulationStore.ts'

const simulationFlag = 'termous-update-simulation'
const simulationID = 'update-simulation-id'
const simulationOwner = 'update-owner'
const simulationOwnerActor = 'update-owner-actor'
const simulationStateActor = 'update-state-actor'
const simulationPhase = 'update-phase'
const simulationIntent = 'update-intent'
const simulationStateSequence = 'update-state-seq'
const simulationGeneration = 'update-generation'
const supportedPhases = new Set<UpdatePhase>([
  'idle',
  'checking',
  'up_to_date',
  'available',
  'downloading',
  'downloaded',
  'error',
])

export interface DevelopmentUpdateSimulation {
  buildInfo: AppBuildInfo
  mainBridge: UpdateRuntimeBridge
  updateWindowBridge: TermousUpdateWindowBridge
}

export function createDevelopmentUpdateSimulation(
  isDevelopment: boolean,
  search: string,
  browserWindow: Pick<Window, 'open' | 'close' | 'location'> = window,
): DevelopmentUpdateSimulation | null {
  if (!isDevelopment) {
    return null
  }
  const params = new URLSearchParams(search)
  if (params.get(simulationFlag) !== '1') {
    return null
  }

  let channel: DevelopmentUpdateSimulationChannel | null = null
  const isReplica = params.get(simulationOwner) === '1'
  const actorId = createDevelopmentSimulationIdentity()
  const ownerActorId = readSimulationIdentity(params, simulationOwnerActor)
    ?? actorId
  const simulationId = readSimulationIdentity(params, simulationID)
    ?? createDevelopmentSimulationIdentity()
  const initialIntent = readSimulationIntent(params)
  const store = createDevelopmentUpdateSimulationStore(
    readSimulationPhase(params),
    readSimulationCounter(params, simulationStateSequence),
    readSimulationCounter(params, simulationGeneration),
    readSimulationIdentity(params, simulationStateActor) ?? actorId,
    actorId,
    isReplica ? ownerActorId : null,
    (snapshot) => {
      if (!isReplica) {
        channel?.publish(snapshot)
      }
    },
  )
  channel = connectDevelopmentUpdateSimulationChannel({
    actorId,
    getSnapshot: store.getSnapshot,
    handleAction: isReplica
      ? undefined
      : (action) => handleDevelopmentAction(store, action),
    onSnapshot: store.mergeRemote,
    ownerActorId,
    simulationId,
  })
  channel.requestSnapshot()
  const check = isReplica
    ? () => channel!.requestAction({ type: 'check' })
    : store.check
  const setPreferences = isReplica
    ? (patch: Parameters<typeof store.setPreferences>[0]) => (
        channel!.requestAction({ type: 'set_preferences', patch })
          .then((snapshot) => ({ ...snapshot.preferences }))
      )
    : store.setPreferences
  const download = isReplica
    ? () => channel!.requestAction({ type: 'download' })
    : store.download
  const cancelDownload = isReplica
    ? () => channel!.requestAction({ type: 'cancel_download' })
    : store.cancelDownload
  const installBoundary = isReplica
    ? () => channel!.requestAction({ type: 'install_boundary' })
    : store.simulateInstallBoundary
  const bootstrapListeners = new Set<(
    bootstrap: UpdateWindowBootstrap<UpdateSnapshot>,
  ) => void>()
  const summaryListeners = new Set<(state: { revision: number; ready: boolean }) => void>()
  const bootstrapSequence = 1
  const getBootstrap = (): UpdateWindowBootstrap<UpdateSnapshot> => ({
    bootstrap_seq: bootstrapSequence,
    intent: initialIntent,
    language: readDevelopmentUpdateLanguage(),
    snapshot: store.getSnapshot(),
    theme: readDevelopmentUpdateTheme(),
  })

  const openUpdateWindow = (intent: 'inspect' | 'start_download' = 'inspect') => {
    const url = new URL(browserWindow.location.href)
    const current = store.getSnapshot()
    url.searchParams.set('surface', 'update')
    url.searchParams.set(simulationFlag, '1')
    url.searchParams.set(simulationID, simulationId)
    url.searchParams.set(simulationOwner, '1')
    url.searchParams.set(simulationOwnerActor, actorId)
    url.searchParams.set(simulationPhase, current.phase)
    url.searchParams.set(simulationIntent, intent)
    url.searchParams.set(simulationStateActor, store.getRevisionActor())
    url.searchParams.set(simulationStateSequence, String(current.state_seq))
    url.searchParams.set(
      simulationGeneration,
      String(current.operation_generation),
    )
    const opened = browserWindow.open(
      url.href,
      'termous-update-development-simulation',
      'popup,width=720,height=620',
    )
    return Promise.resolve(Boolean(opened))
  }

  const simulation: DevelopmentUpdateSimulation = {
    buildInfo: {
      product_name: 'Termous',
      version: '0.0.1',
      core_version: '0.0.1-simulation',
      platform: readDevelopmentUpdatePlatform(),
      arch: 'x64',
      packaged: false,
      update_channel: 'stable',
      update_supported: true,
      update_support_reason: null,
    },
    mainBridge: {
      subscribe: store.subscribe,
      check,
      setPreferences,
      openWindow: openUpdateWindow,
      // 开发模拟绝不打开真实 Release 页面，避免 UI 验收产生外部网络请求。
      openReleasePage: () => Promise.resolve(false),
    },
    updateWindowBridge: {
      getBootstrap: () => Promise.resolve(getBootstrap()),
      getState: () => Promise.resolve(store.getSnapshot()),
      download,
      cancelDownload,
      prepareInstall: store.prepareInstall,
      install: installBoundary,
      openReleasePage: () => Promise.resolve(false),
      minimize: () => Promise.resolve(false),
      close: () => {
        browserWindow.close()
        return Promise.resolve(true)
      },
      onInstallSummaryChanged: (callback) => {
        summaryListeners.add(callback)
        queueMicrotask(() => {
          if (summaryListeners.has(callback)) {
            callback({ revision: 1, ready: true })
          }
        })
        return () => summaryListeners.delete(callback)
      },
      onBootstrapChanged: (callback) => {
        bootstrapListeners.add(callback)
        return () => bootstrapListeners.delete(callback)
      },
      subscribe: store.subscribe,
    },
  }
  if (initialIntent === 'start_download') {
    // 先给同源主窗口一个快照对账机会，再执行真实入口对应的自动下载意图。
    globalThis.setTimeout(() => {
      void download()
    }, 50)
  }
  return simulation
}

async function handleDevelopmentAction(
  store: DevelopmentUpdateSimulationStore,
  action: DevelopmentUpdateSimulationAction,
) {
  switch (action.type) {
    case 'check':
      return store.check()
    case 'set_preferences':
      await store.setPreferences(action.patch)
      return store.getSnapshot()
    case 'download':
      return store.download()
    case 'cancel_download':
      return store.cancelDownload()
    case 'install_boundary':
      return store.simulateInstallBoundary()
  }
}

function readSimulationPhase(params: URLSearchParams): UpdatePhase {
  const phase = params.get(simulationPhase) as UpdatePhase | null
  return phase && supportedPhases.has(phase) ? phase : 'available'
}

function readSimulationIntent(params: URLSearchParams) {
  return params.get(simulationIntent) === 'start_download'
    ? 'start_download'
    : 'inspect'
}

function readSimulationCounter(params: URLSearchParams, name: string) {
  const value = Number(params.get(name))
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function readSimulationIdentity(params: URLSearchParams, name: string) {
  const value = params.get(name)
  return isDevelopmentUpdateSimulationIdentity(value) ? value : null
}

function createDevelopmentSimulationIdentity() {
  if (
    typeof crypto === 'undefined'
    || typeof crypto.randomUUID !== 'function'
  ) {
    throw new Error('development_update_simulation_identity_unavailable')
  }
  return crypto.randomUUID()
}
