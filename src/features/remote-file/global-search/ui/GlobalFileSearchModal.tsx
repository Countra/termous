import { App as AntdApp, Button, Input, Modal, Segmented, Tooltip } from 'antd'
import type { InputRef } from 'antd'
import {
  CircleAlert,
  File,
  Files,
  Folder,
  FolderSearch2,
  LoaderCircle,
  Search,
  Server,
  Square,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileNameSearchEntryType, FileNameSearchResultItem } from '#entities/file'
import { writeClipboardText } from '#shared/clipboard'
import {
  confirmDialogStyles,
  termousNotificationClassName,
} from '#shared/ui'
import { useGlobalFileSearchController } from '../controller/useGlobalFileSearchController'
import {
  globalFileSearchEntryTypes,
  globalFileSearchInstallCommands,
  globalFileSearchQueryMaxBytes,
} from '../model/globalFileSearchModel'
import type { GlobalFileSearchModalProps } from '../model/types'
import { GlobalFileSearchCapabilityPane } from './GlobalFileSearchCapabilityPane'
import { GlobalFileSearchFilters } from './GlobalFileSearchFilters'
import { GlobalFileSearchResults } from './GlobalFileSearchResults'
import styles from './GlobalFileSearchModal.module.scss'

function formatDuration(durationMs: number) {
  if (durationMs < 1_000) {
    return `${Math.max(0, Math.round(durationMs))} ms`
  }
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`
}

export function GlobalFileSearchModal(props: GlobalFileSearchModalProps) {
  const { open, source, onReveal, onClose } = props
  const { t } = useTranslation()
  const { modal, notification } = AntdApp.useApp()
  const inputRef = useRef<InputRef>(null)
  const controller = useGlobalFileSearchController(props)
  const [locatingPath, setLocatingPath] = useState('')
  const [unavailablePaths, setUnavailablePaths] = useState<ReadonlySet<string>>(() => new Set())
  const mountedRef = useRef(false)
  const revealAttemptRef = useRef(0)
  const revealAbortRef = useRef<AbortController | null>(null)
  const installConfirmRef = useRef<ReturnType<typeof modal.confirm> | null>(null)
  const sourceIdentity = [
    open ? 'open' : 'closed',
    source.fileSessionId,
    String(source.connectionGeneration),
    source.currentPath,
  ].join('\u0000')
  const sourceIdentityRef = useRef(sourceIdentity)
  sourceIdentityRef.current = sourceIdentity
  const capabilityReady = controller.capability?.status === 'ready'

  const destroyInstallConfirm = useCallback(() => {
    installConfirmRef.current?.destroy()
    installConfirmRef.current = null
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      destroyInstallConfirm()
      revealAttemptRef.current += 1
      revealAbortRef.current?.abort()
      revealAbortRef.current = null
    }
  }, [destroyInstallConfirm])

  useEffect(() => {
    destroyInstallConfirm()
    revealAttemptRef.current += 1
    revealAbortRef.current?.abort()
    revealAbortRef.current = null
    setLocatingPath('')
    setUnavailablePaths(new Set())
  }, [destroyInstallConfirm, open, source.connectionGeneration, source.fileSessionId])

  useEffect(() => {
    if (open && capabilityReady && !controller.installBusy) {
      window.requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [capabilityReady, controller.installBusy, open])

  const requestClose = () => {
    if (controller.installBusy) {
      return
    }
    if (controller.searchBusy) {
      controller.stopSearch()
      return
    }
    revealAttemptRef.current += 1
    revealAbortRef.current?.abort()
    revealAbortRef.current = null
    setLocatingPath('')
    onClose()
  }

  const runSearch = async () => {
    if (await controller.runSearch()) {
      setUnavailablePaths(new Set())
    }
  }

  const copyInstallCommand = async () => {
    const commands = globalFileSearchInstallCommands(controller.capability)
    if (commands.length === 0) {
      return
    }
    try {
      await writeClipboardText(commands.join('\n'))
      notification.success({
        title: t('files.globalSearch.installCommandCopied'),
        className: termousNotificationClassName,
      })
    } catch (error) {
      notification.error({
        title: t('files.globalSearch.copyFailed'),
        description: error instanceof Error ? error.message : String(error),
        className: termousNotificationClassName,
      })
    }
  }

  const confirmInstall = () => {
    const capability = controller.capability
    const plan = capability?.install_plan
    if (!plan || !capability.install_available) {
      return
    }
    const expectedSourceIdentity = sourceIdentity
    destroyInstallConfirm()
    const confirmation = modal.confirm({
      title: t(capability.status === 'outdated'
        ? 'files.globalSearch.confirmUpgradeTitle'
        : 'files.globalSearch.confirmInstallTitle'),
      icon: null,
      content: (
        <div className={styles['install-confirm']}>
          <p>{t('files.globalSearch.confirmInstallDescription', { host: source.hostName })}</p>
          <div className={styles['install-command-list']}>
            {plan.commands.map((command) => (
              <div key={command.id}>
                <span>{command.id === 'install-fd'
                  ? t('files.globalSearch.installFdCommand')
                  : command.title}</span>
                <code>{command.command}</code>
              </div>
            ))}
          </div>
          {plan.warnings.length > 0 ? (
            <ul className={styles['install-warnings']}>
              {plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : null}
        </div>
      ),
      okText: t(capability.status === 'outdated'
        ? 'files.globalSearch.upgrade'
        : 'files.globalSearch.install'),
      cancelText: t('app.cancel'),
      className: `${confirmDialogStyles.modal} confirm-modal`,
      rootClassName: `${confirmDialogStyles['modal-root']} termous-modal-root`,
      onOk: async () => {
        if (
          !mountedRef.current
          || sourceIdentityRef.current !== expectedSourceIdentity
        ) {
          return
        }
        await controller.install()
      },
      onCancel: () => {
        if (installConfirmRef.current === confirmation) {
          installConfirmRef.current = null
        }
      },
      afterClose: () => {
        if (installConfirmRef.current === confirmation) {
          installConfirmRef.current = null
        }
      },
    })
    installConfirmRef.current = confirmation
  }

  const reveal = useCallback(async (item: FileNameSearchResultItem) => {
    if (locatingPath || unavailablePaths.has(item.path)) {
      return
    }
    revealAbortRef.current?.abort()
    const abortController = new AbortController()
    revealAbortRef.current = abortController
    const attempt = revealAttemptRef.current + 1
    revealAttemptRef.current = attempt
    const attemptSourceIdentity = sourceIdentity
    const isCurrentAttempt = () => (
      mountedRef.current
      && revealAttemptRef.current === attempt
      && revealAbortRef.current === abortController
      && !abortController.signal.aborted
      && sourceIdentityRef.current === attemptSourceIdentity
    )
    setLocatingPath(item.path)
    try {
      const outcome = await onReveal(item.path, abortController.signal)
      if (!isCurrentAttempt()) {
        return
      }
      if (outcome.status === 'revealed') {
        revealAttemptRef.current += 1
        revealAbortRef.current = null
        setLocatingPath('')
        onClose()
        return
      }
      if (outcome.status === 'missing') {
        setUnavailablePaths((current) => new Set(current).add(item.path))
        notification.warning({
          title: t('files.globalSearch.resultUnavailable'),
          description: t('files.globalSearch.resultUnavailableDescription'),
          className: termousNotificationClassName,
        })
      } else if (outcome.status === 'failed') {
        notification.error({
          title: t('files.globalSearch.revealFailed'),
          description: outcome.description,
          className: termousNotificationClassName,
        })
      }
    } catch (error) {
      if (!isCurrentAttempt()) {
        return
      }
      notification.error({
        title: t('files.globalSearch.revealFailed'),
        description: error instanceof Error ? error.message : String(error),
        className: termousNotificationClassName,
      })
    } finally {
      if (revealAttemptRef.current === attempt) {
        if (revealAbortRef.current === abortController) {
          revealAbortRef.current = null
        }
        if (mountedRef.current) {
          setLocatingPath('')
        }
      }
    }
  }, [locatingPath, notification, onClose, onReveal, sourceIdentity, t, unavailablePaths])

  const result = controller.result
  const queryTooLong = new TextEncoder().encode(controller.query).byteLength
    > globalFileSearchQueryMaxBytes
  const statusError = queryTooLong
    ? t('files.globalSearch.queryTooLong', { count: globalFileSearchQueryMaxBytes })
    : controller.searchError
  const statusErrorTitle = queryTooLong
    ? t('files.globalSearch.queryInvalid')
    : t('files.globalSearch.searchFailed')
  return (
    <Modal
      open={open}
      centered
      destroyOnHidden
      width={980}
      footer={null}
      title={t('files.globalSearch.title')}
      closable={!controller.installBusy}
      keyboard={!controller.installBusy}
      mask={{ closable: !controller.installBusy && !controller.searchBusy }}
      className={styles.modal}
      rootClassName={`${styles['modal-root']} termous-modal-root`}
      getContainer={() => document.body}
      onCancel={requestClose}
    >
      <section className={styles.dialog} aria-labelledby="global-file-search-title">
        <header className={styles.header}>
          <span className={styles['header-icon']} aria-hidden="true">
            <FolderSearch2 size={20} />
          </span>
          <span className={styles['header-copy']}>
            <strong id="global-file-search-title">{t('files.globalSearch.title')}</strong>
            <span><Server size={12} aria-hidden="true" />{source.hostName}</span>
          </span>
          <span className={styles['engine-status']}>
            <i className={capabilityReady ? styles['is-ready'] : ''} aria-hidden="true" />
            <span>{controller.capability?.executable || 'fd'}</span>
            {controller.capability?.version ? <code>{controller.capability.version}</code> : null}
          </span>
        </header>

        {capabilityReady ? (
          <div className={styles.workspace}>
            <form
              className={styles['search-form']}
              role="search"
              onSubmit={(event) => {
                event.preventDefault()
                if (controller.searchBusy) {
                  controller.stopSearch()
                } else {
                  void runSearch()
                }
              }}
            >
              <Input
                ref={inputRef}
                allowClear
                className={styles['search-input']}
                value={controller.query}
                disabled={controller.installBusy}
                status={queryTooLong ? 'error' : undefined}
                prefix={<Search size={16} aria-hidden="true" />}
                placeholder={t(`files.globalSearch.placeholders.${controller.advancedFilters.matchMode}`)}
                aria-label={t('files.globalSearch.query')}
                onChange={(event) => controller.setQuery(event.target.value)}
              />
              <Button
                htmlType="submit"
                type={controller.searchBusy ? 'default' : 'primary'}
                className={styles['search-button']}
                disabled={!controller.searchBusy && !controller.canSearch}
                loading={controller.searchPhase === 'stopping'}
                icon={controller.searchBusy
                  ? <Square size={13} fill="currentColor" aria-hidden="true" />
                  : <Search size={15} aria-hidden="true" />}
              >
                {t(controller.searchBusy
                  ? 'files.globalSearch.stop'
                  : 'files.globalSearch.search')}
              </Button>
            </form>

            <div className={styles['search-options']}>
              <Segmented<FileNameSearchEntryType>
                size="small"
                className={styles['type-segmented']}
                value={controller.entryType}
                disabled={controller.searchBusy}
                aria-label={t('files.globalSearch.entryType')}
                options={globalFileSearchEntryTypes.map((value) => ({
                  value,
                  icon: value === 'file'
                    ? <File size={13} aria-hidden="true" />
                    : value === 'directory'
                      ? <Folder size={13} aria-hidden="true" />
                      : <Files size={13} aria-hidden="true" />,
                  label: t(`files.globalSearch.entryTypes.${value}`),
                }))}
                onChange={(value) => {
                  controller.setEntryType(value)
                  if (value !== 'file') {
                    controller.setAdvancedFilter('minSizeBytes', null)
                    controller.setAdvancedFilter('maxSizeBytes', null)
                  }
                }}
              />
              <GlobalFileSearchFilters
                filters={controller.advancedFilters}
                entryType={controller.entryType}
                oneFileSystem={controller.oneFileSystem}
                searchScope={controller.searchScope}
                currentPath={source.currentPath}
                activeCount={controller.activeAdvancedFilterCount}
                disabled={controller.searchBusy || controller.installBusy}
                onFilterChange={controller.setAdvancedFilter}
                onOneFileSystemChange={controller.setOneFileSystem}
                onSearchScopeChange={controller.setSearchScope}
                onReset={controller.resetAdvancedFilters}
              />
            </div>

            <div
              className={`${styles['result-summary']} ${statusError ? styles['is-error'] : ''}`}
              role={statusError ? 'alert' : 'status'}
              aria-live={statusError ? 'assertive' : 'polite'}
            >
              <span className={styles['result-summary-primary']}>
                {statusError ? (
                  <CircleAlert size={13} aria-hidden="true" />
                ) : controller.searchBusy ? (
                  <LoaderCircle className={styles.spinner} size={13} aria-hidden="true" />
                ) : <Search size={13} aria-hidden="true" />}
                <strong>{statusError
                  ? statusErrorTitle
                  : controller.searchBusy
                    ? t(controller.searchPhase === 'stopping'
                      ? 'files.globalSearch.stopping'
                      : 'files.globalSearch.searching')
                  : result
                    ? t('files.globalSearch.resultCount', { count: result.returned_count })
                    : t('files.globalSearch.ready')}</strong>
              </span>
              {statusError ? (
                <Tooltip title={statusError}>
                  <span className={styles['result-summary-message']}>{statusError}</span>
                </Tooltip>
              ) : null}
              <span className={styles['result-summary-metrics']}>
                {controller.searchBusy && result ? (
                  <small>{t('files.globalSearch.previousResultCount', {
                    count: result.returned_count,
                  })}</small>
                ) : null}
                {result ? <code>{formatDuration(result.duration_ms)}</code> : null}
                {result?.truncated ? (
                  <small className={styles['is-warning']}>{t('files.globalSearch.truncated')}</small>
                ) : null}
                {result?.partial ? (
                  <small className={styles['is-warning']}>{t('files.globalSearch.partial')}</small>
                ) : null}
                {result?.timed_out ? (
                  <small className={styles['is-warning']}>{t('files.globalSearch.timedOut')}</small>
                ) : null}
                {(result?.skipped_invalid_utf8 ?? 0) > 0 ? (
                  <small>{t('files.globalSearch.skippedInvalid', {
                    count: result?.skipped_invalid_utf8,
                  })}</small>
                ) : null}
              </span>
            </div>

            <div className={styles['results-region']}>
              <GlobalFileSearchResults
                result={result}
                phase={controller.searchPhase}
                searchedQuery={controller.searchedQuery}
                locatingPath={locatingPath}
                unavailablePaths={unavailablePaths}
                onReveal={reveal}
              />
            </div>
          </div>
        ) : (
          <div className={styles['capability-region']}>
            <GlobalFileSearchCapabilityPane
              capability={controller.capability}
              phase={controller.capabilityPhase}
              error={controller.capabilityError}
              onRetry={() => void controller.detectCapability()}
              onInstall={confirmInstall}
              onCopyCommand={() => void copyInstallCommand()}
            />
          </div>
        )}

        <footer className={styles.footer}>
          <span>
            {controller.searchBusy
              ? t('files.globalSearch.closeStopsSearch')
              : t('files.globalSearch.scope')}
          </span>
          <Button
            disabled={controller.installBusy}
            onClick={requestClose}
          >
            {t(controller.searchBusy ? 'files.globalSearch.stop' : 'app.close')}
          </Button>
        </footer>
      </section>
    </Modal>
  )
}
