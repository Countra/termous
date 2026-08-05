import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Alert,
  Avatar,
  Button,
  Card,
  Divider,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import {
  Minus,
  X,
} from 'lucide-react'
import { getTermousUpdateBridge } from '#shared/bridge'
import type {
  UpdateApplicationInfo,
  UpdateInstallConfirmation,
  UpdateSnapshot,
  UpdateWindowBootstrap,
} from '#common/contracts'
import { TermousUiProvider } from '../../app/TermousUiProvider'
import type { Language, ThemeMode } from '../../types/domain'
import { readDevelopmentUpdateSimulation } from './developmentUpdateSimulationSlot'
import {
  UpdateWindowPrimaryActionIcon,
  UpdateWindowVersionBlock,
} from './UpdateWindowElements'
import { UpdateReleaseNotesView } from './UpdateReleaseNotesView'
import { UpdateWindowStatusPanel } from './UpdateWindowStatusPanel'
import {
  formatReleaseDate,
  primaryActionLabel,
  windowCopy,
} from './updateWindowCopy'
import {
  canPrepareUpdateInstall,
  isInstallConfirmationCurrent,
  isUpdateWindowPrimaryActionBlocked,
  mergeUpdateWindowBootstrap,
  mergeUpdateWindowSnapshot,
  resolveUpdateWindowPrimaryAction,
  resolveUpdateWindowVisiblePrimaryAction,
  type UpdateWindowPrimaryAction,
  type UpdateWindowBusyAction,
} from './updateWindowUiState'
import './update-window.css'

const initialBootstrap: UpdateWindowBootstrap<UpdateSnapshot> = {
  bootstrap_seq: 0,
  language: navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US',
  snapshot: {
    state_seq: 0,
    operation_generation: 0,
    phase: 'idle',
    current_version: '',
    available_version: null,
    release_name: null,
    release_date: null,
    release_notes: null,
    progress: null,
    checked_at: null,
    error_code: null,
    error_message: null,
    retryable: false,
    support_reason: null,
    preferences: {
      automatic_check: true,
      check_interval: 'daily',
      automatic_download: false,
      last_checked_at: null,
      revision: 0,
    },
    next_automatic_check_at: null,
  },
  theme: window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
}

const developmentUpdateSimulation = readDevelopmentUpdateSimulation()

type UpdateWindowLocalErrorKey =
  | 'actionFailed'
  | 'bootstrapFailed'
  | 'bridgeUnavailable'
  | 'impactChanged'
  | 'installFailed'
  | 'prepareFailed'

export default function UpdateWindowRoot() {
  const [bootstrap, setBootstrap] = useState(initialBootstrap)
  const [busyAction, setBusyAction] = useState<UpdateWindowBusyAction>(null)
  const [confirmation, setConfirmation] = useState<UpdateInstallConfirmation | null>(null)
  const [confirmationUnavailable, setConfirmationUnavailable] = useState(false)
  const [localError, setLocalError] = useState<UpdateWindowLocalErrorKey | null>(null)
  const [applicationInfo, setApplicationInfo] = useState<UpdateApplicationInfo | null>(null)
  const snapshotRef = useRef(bootstrap.snapshot)
  const confirmationRef = useRef<UpdateInstallConfirmation | null>(null)
  const confirmationRequestRef = useRef<{
    stateSequence: number
    promise: Promise<UpdateInstallConfirmation | null>
  } | null>(null)
  const summaryReadyRef = useRef<boolean | null>(null)
  const summaryRevisionRef = useRef<number | null>(null)
  const language = bootstrap.language
  const text = useMemo(() => windowCopy(language), [language])
  const snapshot = bootstrap.snapshot
  const bridge = getTermousUpdateBridge()
    ?? developmentUpdateSimulation?.updateWindowBridge
  const primaryAction = resolveUpdateWindowPrimaryAction(snapshot)
  const visiblePrimaryAction = resolveUpdateWindowVisiblePrimaryAction(
    snapshot,
    busyAction,
  )
  const isInstalling = snapshot.phase === 'preparing_install' || snapshot.phase === 'installing'
  const isMac = navigator.userAgent.includes('Macintosh')
  const currentConfirmation = isInstallConfirmationCurrent(confirmation, snapshot)
    ? confirmation
    : null
  const installActionNeedsConfirmation = (
    primaryAction === 'install'
    || primaryAction === 'retry_install'
  )
  const updateConfirmation = useCallback((
    next: UpdateInstallConfirmation | null,
  ) => {
    confirmationRef.current = next
    setConfirmation(next)
  }, [])

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  useEffect(() => {
    if (!bridge) {
      setLocalError('bridgeUnavailable')
      return
    }
    let active = true
    let bootstrapReady = false
    const markBootstrapReady = () => {
      bootstrapReady = true
      setLocalError((current) => (
        current === 'bootstrapFailed' || current === 'bridgeUnavailable'
          ? null
          : current
      ))
    }
    const mergeBootstrap = (next: UpdateWindowBootstrap<UpdateSnapshot>) => {
      if (!active) {
        return
      }
      markBootstrapReady()
      setBootstrap((current) => mergeUpdateWindowBootstrap(current, next))
    }
    const mergeSnapshot = (next: UpdateSnapshot) => {
      if (!active) {
        return
      }
      markBootstrapReady()
      setBootstrap((current) => ({
        ...current,
        snapshot: mergeUpdateWindowSnapshot(current.snapshot, next),
      }))
    }
    const removeBootstrapListener = bridge.onBootstrapChanged(mergeBootstrap)
    const removeStateListener = bridge.subscribe(mergeSnapshot)
    void bridge.getBootstrap().then(mergeBootstrap).catch(() => {
      if (active && !bootstrapReady) {
        setLocalError('bootstrapFailed')
      }
    })
    void bridge.getApplicationInfo().then((info) => {
      if (active) {
        setApplicationInfo(info)
      }
    }).catch(() => {
      // 软件信息加载失败不阻断更新状态与操作。
    })
    return () => {
      active = false
      removeBootstrapListener()
      removeStateListener()
    }
  }, [bridge])

  const requestInstallConfirmation = useCallback(async (
    reportError: boolean,
    forceRefresh = false,
  ): Promise<UpdateInstallConfirmation | null> => {
    const currentBridge = bridge
    const currentSnapshot = snapshotRef.current
    if (!currentBridge || !canPrepareUpdateInstall(currentSnapshot)) {
      return null
    }
    if (
      !forceRefresh
      && confirmationRef.current
      && isInstallConfirmationCurrent(confirmationRef.current, currentSnapshot)
      && Date.parse(confirmationRef.current.expires_at) > Date.now() + 5_000
    ) {
      return confirmationRef.current
    }
    const existing = confirmationRequestRef.current
    if (existing?.stateSequence === currentSnapshot.state_seq) {
      if (!forceRefresh) {
        return existing.promise
      }
      await existing.promise
      if (snapshotRef.current.state_seq !== currentSnapshot.state_seq) {
        return null
      }
    }

    setBusyAction((current) => current ?? 'prepare')
    setConfirmationUnavailable(false)
    const workflow = currentBridge.prepareInstall()
      .then((next) => {
        const latest = snapshotRef.current
        if (
          next.state_seq !== latest.state_seq
          || next.operation_generation !== latest.operation_generation
          || (
            summaryRevisionRef.current !== null
            && next.summary_revision !== summaryRevisionRef.current
          )
          || !isInstallConfirmationCurrent(next, latest)
        ) {
          return null
        }
        summaryReadyRef.current = true
        summaryRevisionRef.current = next.summary_revision
        updateConfirmation(next)
        setLocalError((current) => current === 'prepareFailed' ? null : current)
        return next
      })
      .catch(() => {
        if (confirmationRequestRef.current?.promise !== workflow) {
          return null
        }
        updateConfirmation(null)
        setConfirmationUnavailable(true)
        if (reportError) {
          setLocalError('prepareFailed')
        }
        return null
      })
      .finally(() => {
        if (confirmationRequestRef.current?.promise === workflow) {
          confirmationRequestRef.current = null
          setBusyAction((current) => current === 'prepare' ? null : current)
        }
      })
    confirmationRequestRef.current = {
      stateSequence: currentSnapshot.state_seq,
      promise: workflow,
    }
    return workflow
  }, [bridge, updateConfirmation])

  useEffect(() => {
    if (!bridge) {
      return
    }
    return bridge.onInstallSummaryChanged((state) => {
      summaryReadyRef.current = state.ready
      summaryRevisionRef.current = state.revision
      confirmationRequestRef.current = null
      updateConfirmation(null)
      setConfirmationUnavailable(!state.ready)
      const willRefresh = state.ready && canPrepareUpdateInstall(snapshotRef.current)
      if (willRefresh) {
        void requestInstallConfirmation(false, true)
      } else {
        setBusyAction((current) => current === 'prepare' ? null : current)
      }
    })
  }, [bridge, requestInstallConfirmation, updateConfirmation])

  useEffect(() => {
    if (canPrepareUpdateInstall(snapshot)) {
      if (!isInstallConfirmationCurrent(confirmation, snapshot)) {
        updateConfirmation(null)
      }
      if (summaryReadyRef.current !== false) {
        void requestInstallConfirmation(false)
      }
      return
    }
    updateConfirmation(null)
    setConfirmationUnavailable(false)
    confirmationRequestRef.current = null
    setBusyAction((current) => current === 'prepare' ? null : current)
  }, [
    requestInstallConfirmation,
    confirmation,
    snapshot,
    updateConfirmation,
  ])

  const mergeReturnedSnapshot = useCallback((next: UpdateSnapshot) => {
    setBootstrap((current) => ({
      ...current,
      snapshot: mergeUpdateWindowSnapshot(current.snapshot, next),
    }))
  }, [])

  const runPrimaryAction = useCallback(async (action: UpdateWindowPrimaryAction) => {
    const currentBridge = bridge
    if (
      !currentBridge
      || action === 'none'
      || isUpdateWindowPrimaryActionBlocked(action, busyAction)
    ) {
      return
    }
    setLocalError(null)
    setBusyAction(action)
    try {
      if (action === 'check') {
        mergeReturnedSnapshot(await currentBridge.check())
      } else if (action === 'download' || action === 'retry_download') {
        mergeReturnedSnapshot(await currentBridge.download())
      } else if (action === 'cancel') {
        mergeReturnedSnapshot(await currentBridge.cancelDownload())
      } else {
        const displayedConfirmation = currentConfirmation
        const prepared = await requestInstallConfirmation(true, true)
        if (!prepared) {
          return
        }
        if (
          !displayedConfirmation
          || displayedConfirmation.summary_revision !== prepared.summary_revision
        ) {
          setLocalError('impactChanged')
          return
        }
        mergeReturnedSnapshot(await currentBridge.install(prepared.confirmation_token))
      }
    } catch {
      updateConfirmation(null)
      confirmationRequestRef.current = null
      setLocalError(
        action === 'install' || action === 'retry_install'
          ? 'installFailed'
          : 'actionFailed',
      )
    } finally {
      setBusyAction((current) => current === action ? null : current)
    }
  }, [
    bridge,
    busyAction,
    currentConfirmation,
    mergeReturnedSnapshot,
    requestInstallConfirmation,
    updateConfirmation,
  ])

  const closeWindow = useCallback(async () => {
    if (isInstalling || busyAction === 'close') {
      return
    }
    if (!bridge) {
      window.close()
      return
    }
    setBusyAction('close')
    try {
      await bridge.close()
    } finally {
      setBusyAction((current) => current === 'close' ? null : current)
    }
  }, [bridge, busyAction, isInstalling])

  const minimizeWindow = useCallback(() => {
    void bridge?.minimize()
  }, [bridge])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isInstalling) {
        return
      }
      event.preventDefault()
      void closeWindow()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeWindow, isInstalling])

  const productName = applicationInfo?.product_name || 'Termous'
  const currentVersion = applicationInfo?.version || snapshot.current_version
  const hasUpdateDetails = Boolean(
    snapshot.available_version
    || snapshot.release_notes,
  )
  const systemValue = applicationInfo
    ? `${formatPlatform(applicationInfo.platform)} (${applicationInfo.arch})`
    : text.unavailable

  return (
    <TermousUiProvider
      language={language as Language}
      theme={bootstrap.theme as ThemeMode}
    >
      <main
        className={`update-window-root${isMac ? ' is-macos' : ''}`}
        data-update-phase={snapshot.phase}
        aria-busy={busyAction !== null}
      >
        <header className="update-window-titlebar">
          <div className="update-window-title">
            <span>{text.aboutTermous}</span>
          </div>
          {!isMac ? (
            <div className="update-window-controls">
              <Tooltip title={text.minimize}>
                <Button
                  type="text"
                  className="update-window-control"
                  aria-label={text.minimize}
                  disabled={!bridge}
                  icon={<Minus size={15} />}
                  onClick={minimizeWindow}
                />
              </Tooltip>
              <Tooltip title={text.close}>
                <Button
                  type="text"
                  className="update-window-control is-close"
                  aria-label={text.close}
                  disabled={isInstalling}
                  icon={<X size={15} />}
                  onClick={() => void closeWindow()}
                />
              </Tooltip>
            </div>
          ) : null}
        </header>

        <div className={`update-window-content${hasUpdateDetails ? ' has-update-details' : ''}`}>
          <section className="update-window-about-section" aria-labelledby="update-window-product-name">
            <Avatar
              className="update-window-product-icon"
              shape="square"
              src="./termous-icon.png"
              alt=""
            />
            <div className="update-window-product-copy">
              <Typography.Title id="update-window-product-name" level={1}>
                {productName}
              </Typography.Title>
              <div className="update-window-product-meta">
                <Tag className="update-window-version-tag" variant="filled">
                  {currentVersion ? `v${currentVersion}` : text.unavailable}
                </Tag>
                <span className="update-window-meta-divider" aria-hidden="true" />
                <Typography.Text className="update-window-system-value">
                  {systemValue}
                </Typography.Text>
              </div>
            </div>
          </section>

          <Card
            className={`update-window-update-card${hasUpdateDetails ? ' has-update-details' : ''}`}
            role="region"
            aria-labelledby="update-window-update-title"
            title={(
              <Typography.Title id="update-window-update-title" level={2}>
                {text.softwareUpdate}
              </Typography.Title>
            )}
          >
            <UpdateWindowStatusPanel
              confirmation={currentConfirmation}
              confirmationBusy={busyAction === 'prepare'}
              confirmationUnavailable={confirmationUnavailable}
              language={language}
              onRetryConfirmation={() => {
                setLocalError(null)
                void requestInstallConfirmation(true, true)
              }}
              snapshot={snapshot}
              text={text}
            />

            {snapshot.available_version ? (
              <div className="update-window-version-route" aria-label={text.versionRoute}>
                <UpdateWindowVersionBlock label={text.currentVersion} version={snapshot.current_version} />
                <span className="update-window-version-connector" aria-hidden="true" />
                <div className="update-window-version-target">
                  <UpdateWindowVersionBlock
                    label={text.targetVersion}
                    version={snapshot.available_version}
                    isTarget
                  />
                  {snapshot.release_date ? (
                    <Typography.Text className="update-window-release-date" type="secondary">
                      {formatReleaseDate(snapshot.release_date, language, text.dateUnknown)}
                    </Typography.Text>
                  ) : null}
                </div>
              </div>
            ) : null}

            {localError ? (
              <Alert
                className="update-window-local-alert"
                type="error"
                showIcon
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
                title={text[localError]}
              />
            ) : null}

            {hasUpdateDetails ? (
              <section className="update-window-notes-section" aria-labelledby="update-release-notes-title">
                <Divider className="update-window-notes-divider" />
                <div className="update-window-section-heading">
                  <Typography.Title id="update-release-notes-title" level={3}>
                    {text.releaseNotes}
                  </Typography.Title>
                </div>
                <UpdateReleaseNotesView
                  fallback={text.noReleaseNotes}
                  label={text.releaseNotes}
                  notes={snapshot.release_notes}
                />
              </section>
            ) : null}
          </Card>
        </div>

        <footer className="update-window-footer">
          <Space className="update-window-actions" size={10}>
            <Button
              className="update-window-secondary-action"
              disabled={isInstalling}
              loading={busyAction === 'close'}
              onClick={() => void closeWindow()}
            >
              {snapshot.phase === 'downloaded' ? text.later : text.close}
            </Button>
            {visiblePrimaryAction !== 'none' ? (
              <Button
                type={visiblePrimaryAction === 'cancel' ? 'default' : 'primary'}
                className="update-window-primary-action"
                danger={false}
                disabled={(
                  primaryAction === 'none'
                  ||
                  isUpdateWindowPrimaryActionBlocked(
                    primaryAction,
                    busyAction,
                  )
                  || isInstalling
                  || !bridge
                  || (installActionNeedsConfirmation && !currentConfirmation)
                )}
                loading={(
                  busyAction === visiblePrimaryAction
                  || busyAction === 'prepare'
                  || snapshot.phase === 'checking'
                  || snapshot.phase === 'preparing_install'
                  || snapshot.phase === 'installing'
                )}
                icon={<UpdateWindowPrimaryActionIcon action={visiblePrimaryAction} />}
                onClick={() => void runPrimaryAction(primaryAction)}
              >
                {primaryActionLabel(visiblePrimaryAction, text, currentConfirmation)}
              </Button>
            ) : null}
          </Space>
        </footer>
      </main>
    </TermousUiProvider>
  )
}

function formatPlatform(platform: string) {
  if (platform === 'win32') {
    return 'Windows'
  }
  if (platform === 'darwin') {
    return 'macOS'
  }
  if (platform === 'linux') {
    return 'Linux'
  }
  return platform
}
