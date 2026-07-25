import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button, Tooltip } from 'antd'
import {
  ArrowRight,
  CircleAlert,
  Download,
  ExternalLink,
  Minus,
  ShieldCheck,
  X,
} from 'lucide-react'
import type { UpdateInstallConfirmation } from '../../../electron/updateRuntime'
import type { UpdateWindowBootstrap } from '../../../electron/updateWindow'
import type { UpdateSnapshot } from '../../../electron/updateTypes'
import { TermousUiProvider } from '../../app/TermousUiProvider'
import type { Language, ThemeMode } from '../../types/domain'
import {
  UpdateWindowPrimaryActionIcon,
  UpdateWindowVersionBlock,
} from './UpdateWindowElements'
import { UpdateWindowStatusPanel } from './UpdateWindowStatusPanel'
import {
  formatReleaseDate,
  phaseDescription,
  primaryActionLabel,
  windowCopy,
} from './updateWindowCopy'
import {
  canPrepareUpdateInstall,
  isInstallConfirmationCurrent,
  mergeUpdateWindowBootstrap,
  mergeUpdateWindowSnapshot,
  resolveUpdateWindowPrimaryAction,
  type UpdateWindowPrimaryAction,
} from './updateWindowUiState'
import './update-window.css'

const initialBootstrap: UpdateWindowBootstrap<UpdateSnapshot> = {
  bootstrap_seq: 0,
  intent: 'inspect',
  language: navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US',
  snapshot: {
    state_seq: 0,
    operation_generation: 0,
    phase: 'idle',
    current_version: '',
    available_version: null,
    release_name: null,
    release_date: null,
    release_url: null,
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

type BusyAction = UpdateWindowPrimaryAction | 'prepare' | 'close' | null

export default function UpdateWindowRoot() {
  const [bootstrap, setBootstrap] = useState(initialBootstrap)
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [confirmation, setConfirmation] = useState<UpdateInstallConfirmation | null>(null)
  const [confirmationUnavailable, setConfirmationUnavailable] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const snapshotRef = useRef(bootstrap.snapshot)
  const textRef = useRef(windowCopy(bootstrap.language))
  const confirmationRequestRef = useRef<{
    stateSequence: number
    promise: Promise<UpdateInstallConfirmation | null>
  } | null>(null)
  const summaryReadyRef = useRef<boolean | null>(null)
  const summaryRevisionRef = useRef<number | null>(null)
  const language = bootstrap.language
  const text = useMemo(() => windowCopy(language), [language])
  const snapshot = bootstrap.snapshot
  const bridge = window.termousUpdate
  const primaryAction = resolveUpdateWindowPrimaryAction(snapshot)
  const isInstalling = snapshot.phase === 'preparing_install' || snapshot.phase === 'installing'
  const isMac = navigator.userAgent.includes('Macintosh')
  const currentConfirmation = isInstallConfirmationCurrent(confirmation, snapshot)
    ? confirmation
    : null
  const installActionNeedsConfirmation = (
    primaryAction === 'install'
    || primaryAction === 'retry_install'
  )

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  useEffect(() => {
    textRef.current = text
  }, [text])

  useEffect(() => {
    if (!bridge) {
      setLocalError(textRef.current.bridgeUnavailable)
      return
    }
    let active = true
    const mergeBootstrap = (next: UpdateWindowBootstrap<UpdateSnapshot>) => {
      if (!active) {
        return
      }
      setBootstrap((current) => mergeUpdateWindowBootstrap(current, next))
    }
    const mergeSnapshot = (next: UpdateSnapshot) => {
      if (!active) {
        return
      }
      setBootstrap((current) => ({
        ...current,
        snapshot: mergeUpdateWindowSnapshot(current.snapshot, next),
      }))
    }
    const removeBootstrapListener = bridge.onBootstrapChanged(mergeBootstrap)
    const removeStateListener = bridge.subscribe(mergeSnapshot)
    void bridge.getBootstrap().then(mergeBootstrap).catch(() => {
      if (active) {
        setLocalError(textRef.current.bootstrapFailed)
      }
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
    const currentBridge = window.termousUpdate
    const currentSnapshot = snapshotRef.current
    if (!currentBridge || !canPrepareUpdateInstall(currentSnapshot)) {
      return null
    }
    if (
      !forceRefresh
      && confirmation
      && isInstallConfirmationCurrent(confirmation, currentSnapshot)
      && Date.parse(confirmation.expires_at) > Date.now() + 5_000
    ) {
      return confirmation
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
        setConfirmation(next)
        return next
      })
      .catch(() => {
        if (confirmationRequestRef.current?.promise !== workflow) {
          return null
        }
        setConfirmation(null)
        setConfirmationUnavailable(true)
        if (reportError) {
          setLocalError(text.prepareFailed)
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
  }, [confirmation, text.prepareFailed])

  useEffect(() => {
    if (!bridge) {
      return
    }
    return bridge.onInstallSummaryChanged((state) => {
      summaryReadyRef.current = state.ready
      summaryRevisionRef.current = state.revision
      confirmationRequestRef.current = null
      setConfirmation(null)
      setConfirmationUnavailable(!state.ready)
      const willRefresh = state.ready && canPrepareUpdateInstall(snapshotRef.current)
      if (willRefresh) {
        void requestInstallConfirmation(false, true)
      } else {
        setBusyAction((current) => current === 'prepare' ? null : current)
      }
    })
  }, [bridge, requestInstallConfirmation])

  useEffect(() => {
    if (canPrepareUpdateInstall(snapshot)) {
      if (!isInstallConfirmationCurrent(confirmation, snapshot)) {
        setConfirmation(null)
      }
      if (summaryReadyRef.current !== false) {
        void requestInstallConfirmation(false)
      }
      return
    }
    setConfirmation(null)
    setConfirmationUnavailable(false)
    confirmationRequestRef.current = null
    setBusyAction((current) => current === 'prepare' ? null : current)
  }, [
    requestInstallConfirmation,
    confirmation,
    snapshot,
  ])

  const mergeReturnedSnapshot = useCallback((next: UpdateSnapshot) => {
    setBootstrap((current) => ({
      ...current,
      snapshot: mergeUpdateWindowSnapshot(current.snapshot, next),
    }))
  }, [])

  const runPrimaryAction = useCallback(async (action: UpdateWindowPrimaryAction) => {
    const currentBridge = window.termousUpdate
    if (!currentBridge || action === 'none' || busyAction) {
      return
    }
    setLocalError(null)
    setBusyAction(action)
    try {
      if (action === 'download' || action === 'retry_download') {
        mergeReturnedSnapshot(await currentBridge.download())
      } else if (action === 'cancel') {
        mergeReturnedSnapshot(await currentBridge.cancelDownload())
      } else if (action === 'open_releases') {
        if (!await currentBridge.openReleasePage()) {
          setLocalError(text.openReleaseFailed)
        }
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
          setLocalError(text.impactChanged)
          return
        }
        mergeReturnedSnapshot(await currentBridge.install(prepared.confirmation_token))
      }
    } catch {
      setConfirmation(null)
      confirmationRequestRef.current = null
      setLocalError(
        action === 'install' || action === 'retry_install'
          ? text.installFailed
          : text.actionFailed,
      )
    } finally {
      setBusyAction((current) => current === action ? null : current)
    }
  }, [
    busyAction,
    currentConfirmation,
    mergeReturnedSnapshot,
    requestInstallConfirmation,
    text.actionFailed,
    text.installFailed,
    text.impactChanged,
    text.openReleaseFailed,
  ])

  const closeWindow = useCallback(async () => {
    if (!window.termousUpdate || isInstalling || busyAction === 'close') {
      return
    }
    setBusyAction('close')
    try {
      await window.termousUpdate.close()
    } finally {
      setBusyAction((current) => current === 'close' ? null : current)
    }
  }, [busyAction, isInstalling])

  const minimizeWindow = useCallback(() => {
    void window.termousUpdate?.minimize()
  }, [])

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
            <span className="update-window-brand-mark" aria-hidden="true">
              <Download size={16} strokeWidth={2.1} />
            </span>
            <span>{text.softwareUpdate}</span>
          </div>
          {!isMac ? (
            <div className="update-window-controls">
              <Tooltip title={text.minimize}>
                <Button
                  type="text"
                  className="update-window-control"
                  aria-label={text.minimize}
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

        <div className="update-window-content">
          <section className="update-window-version-section">
            <div className="update-window-eyebrow">{text.versionAvailable}</div>
            <div className="update-window-version-route" aria-label={text.versionRoute}>
              <UpdateWindowVersionBlock label={text.currentVersion} version={snapshot.current_version} />
              <ArrowRight className="update-window-version-arrow" size={18} aria-hidden="true" />
              <UpdateWindowVersionBlock
                label={text.targetVersion}
                version={snapshot.available_version ?? snapshot.current_version}
                isTarget
              />
            </div>
            <div className="update-window-release-meta">
              <span>{snapshot.release_name ?? text.stableRelease}</span>
              <span aria-hidden="true">·</span>
              <span>{formatReleaseDate(snapshot.release_date, language, text.dateUnknown)}</span>
            </div>
          </section>

          <section className="update-window-source-row">
            <span className="update-window-source-copy">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>
                <strong>{text.trustedSource}</strong>
                <small>GitHub Releases · Countra/termous</small>
              </span>
            </span>
            <Button
              type="text"
              className="update-window-link-button"
              icon={<ExternalLink size={14} />}
              onClick={() => void runPrimaryAction('open_releases')}
            >
              {text.viewRelease}
            </Button>
          </section>

          <section className="update-window-notes-section" aria-labelledby="update-release-notes-title">
            <div className="update-window-section-heading">
              <h2 id="update-release-notes-title">{text.releaseNotes}</h2>
              <span>{text.releaseNotesHint}</span>
            </div>
            <div className="update-window-release-notes" tabIndex={0}>
              {snapshot.release_notes || text.noReleaseNotes}
            </div>
          </section>

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
        </div>

        <footer className="update-window-footer">
          <div className="update-window-live-message" aria-live="polite" aria-atomic="true">
            {localError ? (
              <span className="update-window-local-error">
                <CircleAlert size={14} aria-hidden="true" />
                {localError}
              </span>
            ) : (
              <span>{phaseDescription(snapshot, text)}</span>
            )}
          </div>
          <div className="update-window-actions">
            <Button
              className="update-window-secondary-action"
              disabled={isInstalling}
              loading={busyAction === 'close'}
              onClick={() => void closeWindow()}
            >
              {snapshot.phase === 'downloaded' ? text.later : text.close}
            </Button>
            {primaryAction !== 'none' ? (
              <Button
                type={primaryAction === 'cancel' ? 'default' : 'primary'}
                className="update-window-primary-action"
                danger={false}
                disabled={(
                  busyAction !== null
                  || isInstalling
                  || (installActionNeedsConfirmation && !currentConfirmation)
                )}
                loading={busyAction === primaryAction || busyAction === 'prepare'}
                icon={<UpdateWindowPrimaryActionIcon action={primaryAction} />}
                onClick={() => void runPrimaryAction(primaryAction)}
              >
                {primaryActionLabel(primaryAction, text, currentConfirmation)}
              </Button>
            ) : (
              <span className="update-window-action-placeholder" aria-hidden="true" />
            )}
          </div>
        </footer>
      </main>
    </TermousUiProvider>
  )
}
