import {
  AlertTriangle,
  ArrowRightLeft,
  Command,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react'
import { App, Button, Form, Input, Skeleton, Tooltip } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AliasMutationResult,
  ShellAlias,
  ShellAliasInput,
} from '#entities/alias'
import type { CredentialView } from '#entities/credential'
import type { Host, HostGroup, HostReachability } from '#entities/host'
import { uiStyles, WorkspaceEmptyState as WorkbenchEmptyState } from '#shared/ui'
import type { AliasGateway, AliasSessionContext } from '../model/contracts'
import {
  aliasPanelControlScope,
  buildShellAliasPatch,
  filterShellAliases,
} from '../model/aliasWorkspaceState'
import {
  aliasErrorDescription,
  displayAliasShell,
  showAliasError,
} from './aliasPanelHelpers'
import {
  AliasBridgeRepairBar,
  AliasReconnectBar,
  AliasRow,
} from './AliasPanelParts'
import { AliasEditorView, type AliasEditorValues } from './AliasEditorView'
import { AliasSyncModal } from './AliasSyncModal'
import { useAliasSyncActiveIndicator } from '../model/useAliasSyncActiveIndicator'
import { useSessionAliases } from '../model/useSessionAliases'
import styles from './AliasPanel.module.scss'

export interface AliasPanelProps<TSession extends AliasSessionContext = AliasSessionContext> {
  api: AliasGateway
  session: TSession | null
  sessionIds: readonly string[]
  hosts: readonly Host[]
  groups: readonly HostGroup[]
  credentials: readonly CredentialView[]
  reachability: Readonly<Record<string, HostReachability>>
  enabled: boolean
  reconnectDisabled: boolean
  onReconnectSession: (session: TSession) => Promise<void>
}

const emptyEditorValues: AliasEditorValues = {
  name: '',
  command: '',
  description: '',
  enabled: true,
}

export function AliasPanel<TSession extends AliasSessionContext>({
  api,
  session,
  sessionIds,
  hosts,
  groups,
  credentials,
  reachability,
  enabled,
  reconnectDisabled,
  onReconnectSession,
}: AliasPanelProps<TSession>) {
  const { t } = useTranslation()
  const { notification } = App.useApp()
  const aliases = useSessionAliases({ api, session, sessionIds, enabled })
  const sessionId = session?.id ?? ''
  const [query, setQuery] = useState('')
  const [editingAlias, setEditingAlias] = useState<ShellAlias | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorValues, setEditorValues] = useState<AliasEditorValues>(emptyEditorValues)
  const [saving, setSaving] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [deleteConfirmAliasId, setDeleteConfirmAliasId] = useState('')
  const [syncSource, setSyncSource] = useState<{
    session: TSession
    aliases: ShellAlias[]
    shell?: 'bash' | 'zsh' | 'fish'
  } | null>(null)
  const [form] = Form.useForm<AliasEditorValues>()
  const controlScope = aliasPanelControlScope(session?.id)
  const shellRef = useRef<string | undefined>(undefined)
  const sessionIdRef = useRef(sessionId)
  const savingRef = useRef<{ sessionId: string } | null>(null)
  const reconnectingRef = useRef<{ sessionId: string } | null>(null)
  const editorReturnFocusIDRef = useRef('')
  const syncReturnFocusIDRef = useRef('')
  const panelBusy = reconnecting || Boolean(aliases.mutation)
  const activeSyncTask = useAliasSyncActiveIndicator({
    api,
    enabled: enabled && !syncSource,
  })

  sessionIdRef.current = sessionId

  const closeEditorView = useCallback((restoreFocus: boolean) => {
    setEditorOpen(false)
    setEditingAlias(null)
    const returnFocusID = editorReturnFocusIDRef.current
    editorReturnFocusIDRef.current = ''
    if (!restoreFocus || !returnFocusID) {
      return
    }
    window.requestAnimationFrame(() => {
      const returnTarget =
        document.getElementById(returnFocusID) ??
        document.getElementById(`${controlScope}-search`) ??
        document.getElementById(`${controlScope}-create-header`)
      returnTarget?.focus()
    })
  }, [controlScope])

  useEffect(() => {
    setQuery('')
    setEditorOpen(false)
    setEditingAlias(null)
    setDeleteConfirmAliasId('')
    savingRef.current = null
    reconnectingRef.current = null
    setSaving(false)
    setReconnecting(false)
    editorReturnFocusIDRef.current = ''
  }, [session?.id, session?.status])

  useEffect(() => {
    if (!enabled) {
      setEditorOpen(false)
      setEditingAlias(null)
      setDeleteConfirmAliasId('')
      editorReturnFocusIDRef.current = ''
    }
  }, [enabled])

  useEffect(() => {
    if (panelBusy) {
      setDeleteConfirmAliasId('')
    }
  }, [panelBusy])

  const workspace = aliases.workspace
  const bridgeRepairRequired = Boolean(
    workspace?.bridge_status === 'missing' &&
    workspace.items.length > 0 &&
    !aliases.reconnectRequired,
  )
  useEffect(() => {
    const nextShell = workspace?.shell
    if (shellRef.current && nextShell && shellRef.current !== nextShell) {
      setEditorOpen(false)
      setEditingAlias(null)
      editorReturnFocusIDRef.current = ''
    }
    shellRef.current = nextShell
  }, [workspace?.shell])

  useEffect(() => {
    if (editorOpen) {
      form.resetFields()
      form.setFieldsValue(editorValues)
    }
  }, [editorOpen, editorValues, form])

  useEffect(() => {
    if (!enabled || !editorOpen) {
      return undefined
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || saving) {
        return
      }
      event.preventDefault()
      closeEditorView(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeEditorView, editorOpen, enabled, saving])

  const filteredAliases = useMemo(
    () => filterShellAliases(workspace?.items ?? [], query),
    [query, workspace?.items],
  )
  const hasAliasError = Boolean(aliases.errorCode || aliases.errorMessage)

  const openCreate = (returnFocusID: string) => {
    if (panelBusy) {
      return
    }
    editorReturnFocusIDRef.current = returnFocusID
    setEditingAlias(null)
    setEditorValues(emptyEditorValues)
    setEditorOpen(true)
  }

  const openEdit = (alias: ShellAlias) => {
    if (panelBusy) {
      return
    }
    editorReturnFocusIDRef.current = `${controlScope}-alias-${alias.id}`
    setEditingAlias(alias)
    setEditorValues({
      name: alias.name,
      command: alias.command,
      description: alias.description ?? '',
      enabled: alias.enabled,
    })
    setEditorOpen(true)
  }

  const closeEditor = () => {
    if (saving) {
      return
    }
    closeEditorView(true)
  }

  const isCurrentPanelSession = useCallback(
    (expectedSessionId: string) =>
      Boolean(expectedSessionId && sessionIdRef.current === expectedSessionId),
    [],
  )

  const notifyMutation = (
    result: AliasMutationResult,
    successKey: string,
  ) => {
    const reconnectRequired = result.apply_status === 'reconnect_required'
    const descriptionKey = reconnectRequired
      ? 'workbench.aliases.savedReconnectHint'
      : result.apply_status === 'applied'
        ? 'workbench.aliases.savedAppliedHint'
        : 'workbench.aliases.savedNextPromptHint'
    notification[reconnectRequired ? 'warning' : 'success']({
      title: t(successKey),
      description: t(descriptionKey),
      duration: reconnectRequired ? 4 : 2.5,
      role: 'status',
      className: 'termous-notification',
    })
  }

  const persistAlias = async (
    values: AliasEditorValues,
    targetAlias = editingAlias,
  ) => {
    const input: ShellAliasInput = {
      name: values.name,
      command: values.command,
      description: values.description,
      enabled: values.enabled,
    }
    let result: AliasMutationResult
    if (targetAlias) {
      const patch = buildShellAliasPatch(targetAlias, input)
      if (Object.keys(patch).length === 0) {
        return null
      }
      result = await aliases.updateAlias(targetAlias.id, patch)
    } else {
      result = await aliases.createAlias(input)
    }
    return result
  }

  const saveEditor = async (values: AliasEditorValues) => {
    if (savingRef.current) {
      return
    }
    const operation = { sessionId }
    const targetAlias = editingAlias
    savingRef.current = operation
    setSaving(true)
    try {
      const result = await persistAlias(values, targetAlias)
      if (!isCurrentPanelSession(operation.sessionId)) {
        return
      }
      if (!result) {
        closeEditorView(true)
        return
      }
      if (result.alias?.id) {
        editorReturnFocusIDRef.current = `${controlScope}-alias-${result.alias.id}`
      }
      closeEditorView(true)
      notifyMutation(
        result,
        targetAlias ? 'workbench.aliases.updateSuccess' : 'workbench.aliases.createSuccess',
      )
    } catch (error) {
      if (isCurrentPanelSession(operation.sessionId)) {
        showAliasError(error, t, notification)
      }
    } finally {
      if (savingRef.current === operation) {
        savingRef.current = null
        setSaving(false)
      }
    }
  }

  const toggleAlias = async (alias: ShellAlias, enabledValue: boolean) => {
    if (panelBusy) {
      return
    }
    const operationSessionId = sessionId
    try {
      const result = await aliases.updateAlias(alias.id, { enabled: enabledValue })
      if (!isCurrentPanelSession(operationSessionId)) {
        return
      }
      notifyMutation(
        result,
        enabledValue ? 'workbench.aliases.enabledSuccess' : 'workbench.aliases.disabledSuccess',
      )
    } catch (error) {
      if (isCurrentPanelSession(operationSessionId)) {
        showAliasError(error, t, notification)
      }
    } finally {
      if (isCurrentPanelSession(operationSessionId)) {
        window.requestAnimationFrame(() => {
          document
            .getElementById(`${controlScope}-alias-${alias.id}-toggle`)
            ?.focus()
        })
      }
    }
  }

  const removeAlias = async (alias: ShellAlias) => {
    if (panelBusy) {
      return
    }
    const currentIndex = filteredAliases.findIndex((item) => item.id === alias.id)
    const nextFocusAlias =
      filteredAliases[currentIndex + 1] ??
      filteredAliases[currentIndex - 1] ??
      null
    const operationSessionId = sessionId
    setDeleteConfirmAliasId('')
    try {
      const result = await aliases.deleteAlias(alias.id)
      if (!isCurrentPanelSession(operationSessionId)) {
        return
      }
      notifyMutation(result, 'workbench.aliases.deleteSuccess')
      const nextFocusID = nextFocusAlias
        ? `${controlScope}-alias-${nextFocusAlias.id}`
        : `${controlScope}-search`
      window.requestAnimationFrame(() => {
        (
          document.getElementById(nextFocusID) ??
          document.getElementById(`${controlScope}-create-empty`) ??
          document.getElementById(`${controlScope}-create-header`)
        )?.focus()
      })
    } catch (error) {
      if (isCurrentPanelSession(operationSessionId)) {
        showAliasError(error, t, notification)
      }
    }
  }

  const repairAliasBridge = async () => {
    if (!workspace || panelBusy) {
      return
    }
    const operationSessionId = sessionId
    try {
      const result = await aliases.repairBridge()
      if (!isCurrentPanelSession(operationSessionId)) {
        return
      }
      notifyMutation(result, 'workbench.aliases.bridgeRepairSuccess')
    } catch (error) {
      if (isCurrentPanelSession(operationSessionId)) {
        showAliasError(error, t, notification)
      }
    }
  }

  const refreshAliasTemplate = async () => {
    if (panelBusy) {
      return
    }
    const operationSessionId = sessionId
    try {
      const result = await aliases.refreshTemplate()
      if (!isCurrentPanelSession(operationSessionId)) {
        return
      }
      notifyMutation(result, 'workbench.aliases.templateRefreshSuccess')
    } catch (error) {
      if (isCurrentPanelSession(operationSessionId)) {
        showAliasError(error, t, notification)
      }
    }
  }

  const reconnectSession = async () => {
    if (
      !session ||
      reconnectingRef.current ||
      reconnectDisabled ||
      aliases.mutation
    ) {
      return
    }
    const operation = { sessionId }
    reconnectingRef.current = operation
    setReconnecting(true)
    try {
      await onReconnectSession(session)
    } catch (error) {
      if (isCurrentPanelSession(operation.sessionId)) {
        notification.error({
          title: t('workbench.aliases.reconnectFailed'),
          description: error instanceof Error ? error.message : undefined,
          duration: 4,
          role: 'alert',
          className: 'termous-notification',
        })
      }
    } finally {
      if (reconnectingRef.current === operation) {
        reconnectingRef.current = null
        setReconnecting(false)
      }
    }
  }

  const syncEntryID = `${controlScope}-sync`
  const openAliasSync = () => {
    if (!session || (!activeSyncTask && (!workspace || panelBusy))) {
      return
    }
    syncReturnFocusIDRef.current = syncEntryID
    setSyncSource({
      session,
      aliases: workspace ? [...workspace.items] : [],
      shell: workspace?.shell ?? activeSyncTask?.source.shell,
    })
  }
  const closeAliasSync = () => {
    setSyncSource(null)
    const returnFocusID = syncReturnFocusIDRef.current
    syncReturnFocusIDRef.current = ''
    window.requestAnimationFrame(() => {
      (
        document.getElementById(returnFocusID) ??
        document.getElementById(`${controlScope}-search`) ??
        document.getElementById(`${controlScope}-create-header`) ??
        document.getElementById(`${controlScope}-surface`)
      )?.focus()
    })
  }
  const syncEntryButton = session && (activeSyncTask || workspace) ? (
    <Tooltip
      title={t(activeSyncTask
        ? 'workbench.aliases.sync.reattach'
        : 'workbench.aliases.sync.open')}
      classNames={{ root: `${uiStyles.tooltip} termous-tooltip` }}
    >
      <Button
        id={syncEntryID}
        type="text"
        className={[
          styles['alias-icon-button'],
          styles['alias-sync-entry-button'],
          activeSyncTask ? styles['is-active'] : '',
        ].filter(Boolean).join(' ')}
        aria-label={t(activeSyncTask
          ? 'workbench.aliases.sync.reattach'
          : 'workbench.aliases.sync.open')}
        disabled={!activeSyncTask && panelBusy}
        icon={<ArrowRightLeft size={15} />}
        onClick={openAliasSync}
      />
    </Tooltip>
  ) : null
  const syncModal = syncSource ? (
    <AliasSyncModal
      api={api}
      open
      sourceSession={syncSource.session}
      sourceAliases={session?.id === syncSource.session.id && workspace
        ? workspace.items
        : syncSource.aliases}
      sourceShell={session?.id === syncSource.session.id && workspace
        ? workspace.shell
        : syncSource.shell}
      hosts={hosts}
      groups={groups}
      credentials={credentials}
      reachability={reachability}
      onClose={closeAliasSync}
    />
  ) : null
  const renderWithSync = (content: ReactNode, stateSurface = false) => (
    <>
      {stateSurface ? (
        <div
          id={`${controlScope}-surface`}
          className={[styles['alias-panel-state-frame'], styles.root].join(' ')}
          tabIndex={-1}
        >
          {activeSyncTask && syncEntryButton ? (
            <div className={styles['alias-panel-state-actions']}>{syncEntryButton}</div>
          ) : null}
          {content}
        </div>
      ) : content}
      {syncModal}
    </>
  )

  if (!aliases.supported) {
    return renderWithSync(
      <WorkbenchEmptyState
        icon={<Command size={20} />}
        title={t('workbench.aliases.emptyTitle')}
        description={t('workbench.aliases.emptyHint')}
      />,
      true,
    )
  }

  if (aliases.loading && !workspace) {
    return renderWithSync(
      <section
        className={[styles['alias-panel'], styles['alias-panel-loading']].join(' ')}
        role="status"
        aria-busy="true"
        aria-label={t('workbench.aliases.loading')}
      >
        <Skeleton active paragraph={{ rows: 5 }} title={{ width: '54%' }} />
      </section>,
      true,
    )
  }

  if (aliases.templateOutdated || aliases.mutation === 'refresh-template') {
    return renderWithSync(
      <WorkbenchEmptyState
        tone="warning"
        icon={<RefreshCw size={20} />}
        title={t('workbench.aliases.templateOutdatedTitle')}
        description={t('workbench.aliases.templateOutdatedHint')}
        action={
          <Button
            type="primary"
            icon={<RefreshCw size={14} />}
            loading={aliases.mutation === 'refresh-template'}
            disabled={Boolean(aliases.mutation)}
            onClick={() => void refreshAliasTemplate()}
          >
            {t('workbench.aliases.templateRefreshAction')}
          </Button>
        }
      />,
      true,
    )
  }

  if (hasAliasError && !workspace) {
    return renderWithSync(
      <WorkbenchEmptyState
        tone="danger"
        icon={<AlertTriangle size={20} />}
        title={t('workbench.aliases.loadFailed')}
        description={aliasErrorDescription(aliases.errorCode, aliases.errorMessage, t)}
        action={
          <Button
            icon={<RefreshCw size={14} />}
            onClick={() => void aliases.refresh().catch(() => undefined)}
          >
            {t('app.retry')}
          </Button>
        }
      />,
      true,
    )
  }

  if (editorOpen) {
    return renderWithSync(
      <AliasEditorView
        form={form}
        controlScope={controlScope}
        editing={Boolean(editingAlias)}
        saving={saving}
        onSave={(values) => void saveEditor(values)}
        onCancel={closeEditor}
      />,
      true,
    )
  }

  return renderWithSync(
    <section
      id={`${controlScope}-surface`}
      className={[styles['alias-panel'], styles.root].join(' ')}
      tabIndex={-1}
    >
      <header className={styles['alias-panel-header']}>
        <div className={styles['alias-panel-heading']}>
          <span className={styles['alias-panel-heading-icon']}>
            <Command size={16} aria-hidden="true" />
          </span>
          <div>
            <strong>{t('workbench.aliases.title')}</strong>
            <span>{t('workbench.aliases.summary', { shell: displayAliasShell(workspace?.shell), count: workspace?.items.length ?? 0 })}</span>
          </div>
        </div>
        <div className={styles['alias-panel-header-actions']}>
          {syncEntryButton}
          <Tooltip
            title={t('workbench.aliases.refresh')}
            classNames={{ root: `${uiStyles.tooltip} termous-tooltip` }}
          >
            <Button
              type="text"
              className={styles['alias-icon-button']}
              aria-label={t('workbench.aliases.refresh')}
              loading={aliases.refreshing}
              disabled={panelBusy}
              icon={<RefreshCw size={15} />}
              onClick={() => void aliases.refresh(true).catch(() => undefined)}
            />
          </Tooltip>
          <Tooltip
            title={t('workbench.aliases.create')}
            classNames={{ root: `${uiStyles.tooltip} termous-tooltip` }}
          >
            <Button
              id={`${controlScope}-create-header`}
              type="primary"
              className={styles['alias-create-button']}
              aria-label={t('workbench.aliases.create')}
              disabled={panelBusy}
              icon={<Plus size={15} />}
              onClick={() => openCreate(`${controlScope}-create-header`)}
            />
          </Tooltip>
        </div>
      </header>

      <div className={styles['alias-panel-controls']}>
        <div className={styles['alias-panel-search-row']}>
          <Input
            id={`${controlScope}-search`}
            name={`${controlScope}-search`}
            className={`${uiStyles['search-input']} termous-search-input ${styles['alias-search-input']}`}
            value={query}
            allowClear
            variant="borderless"
            prefix={<Search size={14} aria-hidden="true" />}
            placeholder={t('workbench.aliases.searchPlaceholder')}
            aria-label={t('workbench.aliases.searchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {hasAliasError ? (
          <div className={styles['alias-inline-error']} role="alert">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>{aliasErrorDescription(aliases.errorCode, aliases.errorMessage, t)}</span>
          </div>
        ) : null}
        <AliasBridgeRepairBar
          visible={bridgeRepairRequired}
          repairing={aliases.mutation === 'repair'}
          disabled={panelBusy}
          onRepair={() => void repairAliasBridge()}
        />
      </div>

      <div
        className={styles['alias-panel-list']}
        role={filteredAliases.length > 0 ? 'list' : undefined}
        aria-label={t('workbench.aliases.listLabel')}
        aria-busy={aliases.refreshing || Boolean(aliases.mutation)}
      >
        {filteredAliases.length === 0 ? (
          <WorkbenchEmptyState
            className={styles['alias-list-empty']}
            icon={<Command size={19} />}
            title={t(query ? 'workbench.aliases.noResults' : 'workbench.aliases.noAliases')}
            description={query ? undefined : t('workbench.aliases.noAliasesHint')}
            action={!query ? (
              <Button
                id={`${controlScope}-create-empty`}
                size="small"
                type="primary"
                icon={<Plus size={14} />}
                disabled={panelBusy}
                onClick={() => openCreate(`${controlScope}-create-empty`)}
              >
                {t('workbench.aliases.create')}
              </Button>
            ) : undefined}
          />
        ) : (
          filteredAliases.map((alias) => (
            <AliasRow
              key={alias.id}
              id={`${controlScope}-alias-${alias.id}`}
              alias={alias}
              mutation={aliases.mutatingAliasId === alias.id ? aliases.mutation : null}
              panelBusy={panelBusy}
              deleteConfirmOpen={deleteConfirmAliasId === alias.id}
              onDeleteConfirmOpenChange={(open) => {
                setDeleteConfirmAliasId(open ? alias.id : '')
              }}
              onEdit={() => openEdit(alias)}
              onToggle={(checked) => void toggleAlias(alias, checked)}
              onDelete={() => removeAlias(alias)}
            />
          ))
        )}
      </div>

      <AliasReconnectBar
        visible={aliases.reconnectRequired}
        reconnecting={reconnecting}
        reconnectDisabled={reconnectDisabled || Boolean(aliases.mutation)}
        onReconnect={() => void reconnectSession()}
      />
    </section>,
  )
}
