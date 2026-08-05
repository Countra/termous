import type {
  UpdateInstallConfirmation,
  UpdatePhase,
  UpdatePreferences,
  UpdatePreferencesPatch,
  UpdateSnapshot,
} from '#common/contracts'
import {
  mergeUpdatePreferencesByRevision,
  mergeUpdateRuntimeSnapshot,
} from './updateRuntimeState.ts'
import { canPrepareUpdateInstall } from './updateWindowUiState.ts'

const simulationVersion = '0.0.2'
const simulatedTotalBytes = 84 * 1024 * 1024

export interface DevelopmentUpdateSimulationStore {
  getRevisionActor(): string
  getSnapshot(): UpdateSnapshot
  mergeRemote(snapshot: UpdateSnapshot, actorId: string): boolean
  subscribe(callback: (snapshot: UpdateSnapshot) => void): () => void
  check(): Promise<UpdateSnapshot>
  setPreferences(patch: UpdatePreferencesPatch): Promise<UpdatePreferences>
  download(): Promise<UpdateSnapshot>
  cancelDownload(): Promise<UpdateSnapshot>
  prepareInstall(): Promise<UpdateInstallConfirmation>
  simulateInstallBoundary(): Promise<UpdateSnapshot>
}

export function createDevelopmentUpdateSimulationStore(
  initialPhase: UpdatePhase,
  initialStateSequence: number,
  initialGeneration: number,
  initialStateActor: string,
  actorId: string,
  authoritativeActorId: string | null,
  onPublish: (snapshot: UpdateSnapshot) => void,
): DevelopmentUpdateSimulationStore {
  const listeners = new Set<(snapshot: UpdateSnapshot) => void>()
  let stateSequence = Math.max(1, initialStateSequence)
  let operationGeneration = Math.max(
    initialGeneration,
    initialPhase === 'idle' ? 0 : 1,
  )
  let stateActor = initialStateActor
  let awaitingAuthoritativeSnapshot = authoritativeActorId !== null
  let downloadSequence = 0
  let downloadPromise: Promise<UpdateSnapshot> | null = null
  let preferences: UpdatePreferences = {
    automatic_check: true,
    check_interval: 'daily',
    automatic_download: false,
    last_checked_at: '2026-07-25T08:00:00.000Z',
    revision: 1,
  }
  let snapshot: UpdateSnapshot = {
    ...initialSnapshot(initialPhase, preferences),
    state_seq: stateSequence,
    operation_generation: operationGeneration,
  }

  const publish = (patch: Partial<UpdateSnapshot>) => {
    stateSequence += 1
    stateActor = actorId
    snapshot = cloneSnapshot({
      ...snapshot,
      ...patch,
      state_seq: stateSequence,
      operation_generation: operationGeneration,
      preferences,
    })
    notify(listeners, snapshot)
    const published = cloneSnapshot(snapshot)
    onPublish(published)
    return published
  }

  const mergeRemote = (incoming: UpdateSnapshot, incomingActor: string) => {
    const isInitialAuthoritativeSnapshot = (
      awaitingAuthoritativeSnapshot
      && incomingActor === authoritativeActorId
      && incoming.state_seq >= stateSequence
    )
    const incomingWins = (
      isInitialAuthoritativeSnapshot
      || incoming.state_seq > stateSequence
      || (
        incoming.state_seq === stateSequence
        && (
          incomingActor === authoritativeActorId
          || incomingActor > stateActor
        )
      )
    )
    if (!incomingWins) {
      const mergedPreferences = mergeUpdatePreferencesByRevision(
        snapshot.preferences,
        incoming.preferences,
      )
      if (mergedPreferences === snapshot.preferences) {
        return false
      }
      preferences = { ...mergedPreferences }
      snapshot = {
        ...snapshot,
        preferences,
      }
      notify(listeners, snapshot)
      return false
    }
    if (isInitialAuthoritativeSnapshot) {
      awaitingAuthoritativeSnapshot = false
      downloadSequence += 1
      downloadPromise = null
      snapshot = cloneSnapshot(incoming)
      stateSequence = incoming.state_seq
      stateActor = incomingActor
      operationGeneration = incoming.operation_generation
      preferences = { ...incoming.preferences }
      notify(listeners, snapshot)
      return true
    }
    if (
      downloadPromise
      && (
        incoming.operation_generation !== operationGeneration
        || incoming.phase !== 'downloading'
      )
    ) {
      downloadSequence += 1
      downloadPromise = null
    }
    snapshot = mergeUpdateRuntimeSnapshot(snapshot, incoming)
    stateSequence = snapshot.state_seq
    stateActor = incomingActor
    operationGeneration = snapshot.operation_generation
    preferences = { ...snapshot.preferences }
    notify(listeners, snapshot)
    return false
  }

  const check = async () => {
    if (snapshot.phase === 'checking') {
      return cloneSnapshot(snapshot)
    }
    operationGeneration += 1
    publish({
      phase: 'checking',
      error_code: null,
      error_message: null,
      retryable: false,
    })
    await delay(220)
    preferences = {
      ...preferences,
      last_checked_at: new Date().toISOString(),
      revision: preferences.revision + 1,
    }
    return publish({
      phase: 'available',
      ...releaseFields(),
      progress: null,
      checked_at: preferences.last_checked_at,
    })
  }

  const setPreferences = async (patch: UpdatePreferencesPatch) => {
    preferences = {
      ...preferences,
      ...normalizePreferencesPatch(patch),
      revision: preferences.revision + 1,
    }
    publish({ preferences })
    return { ...preferences }
  }

  const download = () => {
    if (downloadPromise) {
      return downloadPromise
    }
    if (
      snapshot.phase !== 'available'
      && snapshot.phase !== 'error'
      && snapshot.phase !== 'downloading'
    ) {
      return Promise.resolve(cloneSnapshot(snapshot))
    }
    operationGeneration += 1
    const sequence = ++downloadSequence
    publish({
      phase: 'downloading',
      ...releaseFields(),
      progress: {
        percent: 0,
        transferred: 0,
        total: simulatedTotalBytes,
        bytes_per_second: 0,
      },
      error_code: null,
      error_message: null,
      retryable: false,
    })

    const operation = runSimulatedDownload(sequence, publish)
      .finally(() => {
        if (downloadPromise === operation) {
          downloadPromise = null
        }
      })
    downloadPromise = operation
    return operation
  }

  const cancelDownload = async () => {
    if (snapshot.phase !== 'downloading') {
      return cloneSnapshot(snapshot)
    }
    downloadSequence += 1
    downloadPromise = null
    return publish({
      phase: 'available',
      progress: null,
      error_code: null,
      error_message: null,
      retryable: false,
    })
  }

  return {
    getRevisionActor: () => stateActor,
    getSnapshot: () => cloneSnapshot(snapshot),
    mergeRemote,
    subscribe: (callback) => {
      listeners.add(callback)
      callback(cloneSnapshot(snapshot))
      return () => listeners.delete(callback)
    },
    check,
    setPreferences,
    download,
    cancelDownload,
    prepareInstall: async () => {
      if (!canPrepareUpdateInstall(snapshot)) {
        throw new Error('update_install_not_ready')
      }
      return {
        confirmation_token: 'development-simulation-install-boundary',
        expires_at: new Date(Date.now() + 120_000).toISOString(),
        state_seq: snapshot.state_seq,
        operation_generation: snapshot.operation_generation,
        summary_revision: 1,
        summary: {
          ssh_sessions: 1,
          file_sessions: 1,
          forwards: 0,
          transfers: 0,
          transfers_complete: true,
        },
      }
    },
    // 开发界面只验证安装操作的错误呈现，绝不触发 Electron 退出或安装器。
    simulateInstallBoundary: async () => publish({
      phase: 'error',
      error_code: 'UPDATE_INSTALL_START_FAILED',
      error_message: '开发模拟不会启动真实安装程序',
      retryable: true,
    }),
  }

  async function runSimulatedDownload(
    sequence: number,
    transition: (patch: Partial<UpdateSnapshot>) => UpdateSnapshot,
  ) {
    const steps = [8, 23, 47, 72, 91, 100]
    for (const percent of steps) {
      await delay(180)
      if (sequence !== downloadSequence) {
        return cloneSnapshot(snapshot)
      }
      const transferred = Math.round(simulatedTotalBytes * percent / 100)
      transition({
        phase: percent === 100 ? 'downloaded' : 'downloading',
        progress: {
          percent,
          transferred,
          total: simulatedTotalBytes,
          bytes_per_second: percent === 100 ? 0 : 12 * 1024 * 1024,
        },
      })
    }
    return cloneSnapshot(snapshot)
  }
}

function initialSnapshot(
  phase: UpdatePhase,
  preferences: UpdatePreferences,
): UpdateSnapshot {
  const hasRelease = phase !== 'idle' && phase !== 'up_to_date'
  const progress = phase === 'downloading'
    ? {
        percent: 42,
        transferred: Math.round(simulatedTotalBytes * 0.42),
        total: simulatedTotalBytes,
        bytes_per_second: 11 * 1024 * 1024,
      }
    : phase === 'downloaded'
      ? {
          percent: 100,
          transferred: simulatedTotalBytes,
          total: simulatedTotalBytes,
          bytes_per_second: 0,
        }
      : null
  return {
    state_seq: 1,
    operation_generation: phase === 'idle' ? 0 : 1,
    phase,
    current_version: '0.0.1',
    ...(hasRelease ? releaseFields() : {
      available_version: null,
      release_name: null,
      release_date: null,
      release_notes: null,
    }),
    progress,
    checked_at: preferences.last_checked_at,
    error_code: phase === 'error' ? 'UPDATE_DOWNLOAD_FAILED' : null,
    error_message: phase === 'error' ? '模拟的更新下载连接已中断' : null,
    retryable: phase === 'error',
    support_reason: null,
    preferences: { ...preferences },
    next_automatic_check_at: '2026-07-26T08:00:00.000Z',
  }
}

function releaseFields() {
  return {
    available_version: simulationVersion,
    release_name: `Termous ${simulationVersion}`,
    release_date: '2026-07-25T08:00:00.000Z',
    release_notes: [
      `## [${simulationVersion}] - 2026-07-25`,
      '',
      '### Added',
      '',
      '- 新增应用内更新状态提示。',
      '- 支持查看下载进度与安装状态。',
      '',
      '### Fixed',
      '',
      '- 修复更新窗口恢复时的状态同步。',
    ].join('\n'),
  }
}

function normalizePreferencesPatch(patch: UpdatePreferencesPatch) {
  const normalized: UpdatePreferencesPatch = {}
  if (typeof patch.automatic_check === 'boolean') {
    normalized.automatic_check = patch.automatic_check
  }
  if (typeof patch.automatic_download === 'boolean') {
    normalized.automatic_download = patch.automatic_download
  }
  if (
    patch.check_interval === 'startup'
    || patch.check_interval === 'daily'
    || patch.check_interval === 'weekly'
  ) {
    normalized.check_interval = patch.check_interval
  }
  return normalized
}

function notify(
  listeners: Set<(snapshot: UpdateSnapshot) => void>,
  snapshot: UpdateSnapshot,
) {
  for (const listener of listeners) {
    listener(cloneSnapshot(snapshot))
  }
}

function cloneSnapshot(snapshot: UpdateSnapshot): UpdateSnapshot {
  return {
    ...snapshot,
    preferences: { ...snapshot.preferences },
    progress: snapshot.progress ? { ...snapshot.progress } : null,
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, milliseconds)
  })
}
