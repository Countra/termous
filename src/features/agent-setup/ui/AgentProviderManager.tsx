import { useEffect, useMemo, useState } from 'react'
import { App as AntdApp, Button, Tabs, Tooltip } from 'antd'
import { Boxes, CloudCog, Plus, Settings2, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentModel, AgentModelProvider } from '#entities/agent'
import { TermousApiError } from '#shared/api'
import { ConfirmDialog, EditorModeContext, termousNotificationClassName, uiStyles } from '#shared/ui'
import {
  AgentProviderProvisionError,
  type AgentSetupController,
} from '../model/useAgentSetupController.ts'
import { AgentModelEditorDialog } from './AgentModelEditorDialog.tsx'
import { AgentModelCatalog } from './AgentModelCatalog.tsx'
import { AgentModelActionDialogs } from './AgentModelActionDialogs.tsx'
import { AgentProviderConnectionForm } from './AgentProviderConnectionForm.tsx'
import { AgentProviderList } from './AgentProviderList.tsx'
import setupStyles from './AgentSetup.module.scss'
import styles from './AgentProviderManager.module.scss'

type PendingNavigation =
  | { kind: 'create' }
  | { kind: 'provider'; id: string }
  | { kind: 'tab'; tab: 'connection' | 'catalog' }

export function AgentProviderManager({
  runtime,
  onEditorConflictVisibilityChange,
}: {
  runtime: AgentSetupController
  onEditorConflictVisibilityChange: (visible: boolean) => void
}) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const [selectedId, setSelectedId] = useState<string | undefined>(() => runtime.providers[0]?.id)
  const [creating, setCreating] = useState(() => runtime.providers.length === 0)
  const [activeTab, setActiveTab] = useState<'connection' | 'catalog'>('connection')
  const [dirty, setDirty] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation>()
  const [formResetGeneration, setFormResetGeneration] = useState(0)
  const [createFocusGeneration, setCreateFocusGeneration] = useState(0)
  const [provisionFailure, setProvisionFailure] = useState<'refresh'>()
  const [deleteProviderId, setDeleteProviderId] = useState<string>()
  const [editModelId, setEditModelId] = useState<string>()
  const [editModelSnapshot, setEditModelSnapshot] = useState<AgentModel>()
  const [creatingModel, setCreatingModel] = useState(false)
  const [removeModelId, setRemoveModelId] = useState<string>()
  const [testModelId, setTestModelId] = useState<string>()
  const [testingProviderId, setTestingProviderId] = useState<string>()
  const [refreshingProviderId, setRefreshingProviderId] = useState<string>()
  const [modelSaveErrorVisible, setModelSaveErrorVisible] = useState(false)
  const [selectedProviderSnapshot, setSelectedProviderSnapshot] = useState<AgentModelProvider | undefined>(
    () => runtime.providers[0],
  )
  const providerById = useMemo(
    () => new Map(runtime.providers.map((provider) => [provider.id, provider])),
    [runtime.providers],
  )
  const modelById = useMemo(
    () => new Map(runtime.models.map((model) => [model.id, model])),
    [runtime.models],
  )
  const modelCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const model of runtime.models) {
      if (model.removed_at) continue
      counts.set(model.provider_id, (counts.get(model.provider_id) ?? 0) + 1)
    }
    return counts
  }, [runtime.models])
  const selectedProvider = selectedId ? providerById.get(selectedId) : undefined
  const editingProvider = selectedProvider
    ?? (!creating && selectedProviderSnapshot?.id === selectedId
      ? selectedProviderSnapshot
      : undefined)
  const selectedProviderMissing = Boolean(!creating && selectedId && !selectedProvider && editingProvider)
  const modelProviderMissing = Boolean(
    (creatingModel || editModelId)
    && selectedId
    && !selectedProvider
    && selectedProviderSnapshot?.id === selectedId,
  )
  const deleteProvider = deleteProviderId ? providerById.get(deleteProviderId) : undefined
  const editModel = editModelId ? modelById.get(editModelId) : undefined
  const editingModel = editModel
    ?? (editModelSnapshot?.id === editModelId ? editModelSnapshot : undefined)
  const editModelMissing = Boolean(editModelId && !editModel && editingModel)
  const editModelRemoved = Boolean(editModel?.removed_at)
  const testModel = testModelId ? modelById.get(testModelId) : undefined
  const removeModel = removeModelId ? modelById.get(removeModelId) : undefined
  const busy = runtime.loading || runtime.mutation !== null

  useEffect(() => {
    if (creating) return
    if (selectedId && providerById.has(selectedId)) return
    if (dirty && selectedProviderSnapshot?.id === selectedId) return
    if ((creatingModel || editModelId) && selectedProviderSnapshot?.id === selectedId) return
    const first = runtime.providers[0]
    setSelectedId(first?.id)
    if (!first && !runtime.loading) setCreating(true)
  }, [
    creating, creatingModel, dirty, editModelId, providerById, runtime.loading,
    runtime.providers, selectedId, selectedProviderSnapshot,
  ])

  useEffect(() => {
    if (selectedProvider) setSelectedProviderSnapshot(selectedProvider)
  }, [selectedProvider])

  useEffect(() => {
    if (deleteProviderId && !deleteProvider) setDeleteProviderId(undefined)
    if (editModelId && !editingModel) setEditModelId(undefined)
    if (testModelId && !testModel) setTestModelId(undefined)
    if (removeModelId && !removeModel) setRemoveModelId(undefined)
  }, [
    deleteProvider, deleteProviderId, editModelId, editingModel, removeModel,
    removeModelId, testModel, testModelId,
  ])

  useEffect(() => {
    if (editModel) setEditModelSnapshot(editModel)
  }, [editModel])

  const navigate = (target: PendingNavigation) => {
    if (dirty) {
      setPendingNavigation(target)
      return
    }
    applyNavigation(target)
  }

  const applyNavigation = (target: PendingNavigation) => {
    setProvisionFailure(undefined)
    setDirty(false)
    if (target.kind === 'create') {
      setCreating(true)
      setActiveTab('connection')
      setCreateFocusGeneration((current) => current + 1)
      return
    }
    if (target.kind === 'provider') {
      setCreating(false)
      setSelectedId(target.id)
      setActiveTab('connection')
      return
    }
    setActiveTab(target.tab)
  }

  const resolveProviderConflict = async () => {
    if (!selectedProvider) return undefined
    if (!runtime.conflict) {
      return providerById.get(selectedProvider.id)
    }
    const snapshot = await runtime.resolveConflict()
    return snapshot?.providers.find(({ id }) => id === selectedProvider.id)
  }

  const resolveModelConflict = async () => {
    if (!editingModel || editModelMissing) return undefined
    const relevantConflict = runtime.conflict?.kind === 'model'
      && runtime.conflict.operation === 'edit'
      && runtime.conflict.modelId === editingModel.id
    if (!relevantConflict) return modelById.get(editingModel.id)
    const snapshot = await runtime.resolveConflict()
    return snapshot?.models.find(({ id }) => id === editingModel.id)
  }

  const saveProvider = async (
    input: Parameters<typeof runtime.saveProvider>[0],
    baseline?: AgentModelProvider,
  ) => {
    try {
      const saved = await runtime.saveProvider(input, baseline)
      setSelectedId(saved.id)
      setCreating(false)
      setDirty(false)
      setFormResetGeneration((current) => current + 1)
      setProvisionFailure(undefined)
      notification.success({
        title: t('settings.agent.providers.saved'),
        className: termousNotificationClassName,
      })
    } catch (error) {
      if (error instanceof AgentProviderProvisionError) {
        setSelectedId(error.providerId)
        setCreating(false)
        setDirty(false)
        setFormResetGeneration((current) => current + 1)
        setProvisionFailure(error.stage)
        notification.warning({
          title: t(`settings.agent.providerEditor.provisionFailure.${error.stage}.title`),
          description: t(`settings.agent.providerEditor.provisionFailure.${error.stage}.description`),
          className: termousNotificationClassName,
        })
      }
      throw error
    }
  }

  const testProvider = async (provider: AgentModelProvider) => {
    setTestingProviderId(provider.id)
    try {
      const result = await runtime.testProvider(provider)
      notification[result.status === 'ready' ? 'success' : 'warning']({
        title: t(result.status === 'ready'
          ? 'settings.agent.providers.testSuccess'
          : 'settings.agent.providers.testFailed', {
          latency: result.latency_ms,
          count: result.model_count,
        }),
        description: t(result.status === 'ready'
          ? 'settings.agent.providers.testReady'
          : 'settings.agent.providers.testUnavailable'),
        className: termousNotificationClassName,
      })
    } catch (error) {
      if (!isRequestAborted(error)) {
        notification.warning({
          title: t('settings.agent.providers.testFailed'),
          description: t('settings.agent.providers.testUnavailable'),
          className: termousNotificationClassName,
        })
      }
      throw error
    } finally {
      setTestingProviderId((current) => current === provider.id ? undefined : current)
    }
  }

  const refreshProvider = async (provider: AgentModelProvider) => {
    setRefreshingProviderId(provider.id)
    try {
      const refreshed = await runtime.refreshProvider(provider)
      const failed = refreshed.refresh_status !== 'ready' || Boolean(refreshed.last_refresh_error_code)
      if (!failed) setProvisionFailure(undefined)
      notification[failed ? 'warning' : 'success']({
        title: t(failed
          ? 'settings.agent.catalog.refreshFailed'
          : 'settings.agent.catalog.refreshSuccess'),
        description: failed ? t('settings.agent.catalog.refreshFailedDescription') : undefined,
        className: termousNotificationClassName,
      })
    } catch (error) {
      if (!isRequestAborted(error)) {
        notification.warning({
          title: t('settings.agent.catalog.refreshFailed'),
          description: t('settings.agent.catalog.refreshFailedDescription'),
          className: termousNotificationClassName,
        })
      }
    } finally {
      setRefreshingProviderId((current) => current === provider.id ? undefined : current)
    }
  }

  const providerModels = selectedProvider
    ? runtime.models.filter(({ provider_id }) => provider_id === selectedProvider.id)
    : []
  const providerConflict = runtime.conflict?.kind === 'provider'
    && runtime.conflict.operation === 'edit'
    && runtime.conflict.providerId === selectedProvider?.id
    && !creating
    && activeTab === 'connection'
  const providerEditorConflict = providerConflict || (selectedProviderMissing && dirty)
  const modelConflict = runtime.conflict?.kind === 'model'
    && runtime.conflict.operation === 'edit'
    && runtime.conflict.modelId === editingModel?.id
  const createModelConflict = creatingModel
    && runtime.conflict?.kind === 'provider'
    && runtime.conflict.providerId === selectedProvider?.id
  const modelEditorConflict = modelConflict
    || createModelConflict
    || editModelMissing
    || editModelRemoved
    || modelProviderMissing
  useEffect(() => {
    onEditorConflictVisibilityChange(Boolean(
      providerEditorConflict || modelEditorConflict || modelSaveErrorVisible,
    ))
  }, [modelEditorConflict, modelSaveErrorVisible, onEditorConflictVisibilityChange, providerEditorConflict])
  const providerContainsDefault = Boolean(selectedProvider && runtime.models.some((model) => (
    model.provider_id === selectedProvider.id
    && model.id === runtime.readiness?.settings.default_model_id
  )))

  return (
    <section className={`${setupStyles.surface} ${styles['provider-management-surface']}`}>
      <header className={`${setupStyles['section-header']} ${styles['provider-management-header']}`}>
        <div className={styles['provider-management-heading']}>
          <span className={styles['provider-management-icon']} aria-hidden="true">
            <CloudCog size={18} />
          </span>
          <div>
            <div className={setupStyles['section-title']}>
              <h2>{t('settings.agent.providers.title')}</h2>
            </div>
            <span>{t('settings.agent.providers.count', { count: runtime.providers.length })}</span>
          </div>
        </div>
        <Button
          type="primary"
          icon={<Plus size={15} aria-hidden="true" />}
          disabled={busy}
          onClick={() => navigate({ kind: 'create' })}
        >
          {t('settings.agent.providers.add')}
        </Button>
      </header>
      <div className={styles['provider-management-layout']}>
        <AgentProviderList
          providers={runtime.providers}
          selectedId={selectedId}
          creating={creating}
          disabled={busy}
          modelCounts={modelCounts}
          onSelect={(id) => navigate({ kind: 'provider', id })}
        />
        <section className={styles['provider-editor']}>
          <header className={styles['provider-editor-header']}>
            <EditorModeContext
              mode={creating ? 'create' : 'edit'}
              label={t(creating ? 'app.add' : 'app.edit')}
              title={<h3>{creating ? t('settings.agent.providers.new') : editingProvider?.name}</h3>}
            />
            {selectedProvider && !creating ? (
              <div className={styles['provider-header-actions']}>
                <Action
                  title={t(providerContainsDefault
                    ? 'settings.agent.providers.deleteDefaultBlocked'
                    : 'app.delete')}
                  icon={<Trash2 size={15} />}
                  disabled={busy || providerContainsDefault}
                  danger
                  onClick={() => setDeleteProviderId(selectedProvider.id)}
                />
              </div>
            ) : null}
          </header>
          {creating || editingProvider ? (
            <Tabs
              activeKey={creating ? 'connection' : activeTab}
              className={styles['provider-tabs']}
              onChange={(key) => navigate({ kind: 'tab', tab: key as 'connection' | 'catalog' })}
              items={[
                {
                  key: 'connection',
                  className: styles['provider-connection-pane'],
                  label: (
                    <span className={styles['provider-tab-label']}>
                      <Settings2 size={14} aria-hidden="true" />
                      {t('settings.agent.providers.connectionTab')}
                    </span>
                  ),
                  children: (
                    <AgentProviderConnectionForm
                      key={`${creating ? 'create' : editingProvider?.id ?? 'missing'}:${formResetGeneration}`}
                      provider={creating ? undefined : editingProvider}
                      busy={busy}
                      conflicted={Boolean(providerEditorConflict)}
                      providerMissing={selectedProviderMissing}
                      provisionFailure={provisionFailure}
                      testing={testingProviderId === selectedProvider?.id}
                      focusRequest={creating ? createFocusGeneration : 0}
                      onDirtyChange={setDirty}
                      onResolveConflict={resolveProviderConflict}
                      onSave={saveProvider}
                      onTest={() => selectedProvider
                        ? testProvider(selectedProvider)
                        : Promise.resolve()}
                    />
                  ),
                },
                ...(!creating && selectedProvider ? [{
                  key: 'catalog',
                  className: styles['provider-catalog-pane'],
                  label: (
                    <span className={styles['provider-tab-label']}>
                      <Boxes size={14} aria-hidden="true" />
                      {t('settings.agent.providers.catalogTab')}
                    </span>
                  ),
                  children: (
                    <AgentModelCatalog
                      provider={selectedProvider}
                      models={providerModels}
                      defaultModelId={runtime.readiness?.settings.default_model_id}
                      disabled={busy}
                      refreshing={refreshingProviderId === selectedProvider.id}
                      onRefresh={() => void refreshProvider(selectedProvider)}
                      onAdd={() => {
                        setEditModelId(undefined)
                        setEditModelSnapshot(undefined)
                        setCreatingModel(true)
                      }}
                      onEdit={(model) => {
                        setCreatingModel(false)
                        setEditModelSnapshot(model)
                        setEditModelId(model.id)
                      }}
                      onTest={(model) => setTestModelId(model.id)}
                      onSetDefault={(model) => void runtime.updateSettings({
                        default_model_id: model.id,
                      }).catch(() => undefined)}
                      onRemove={(model) => setRemoveModelId(model.id)}
                      onRestore={(model) => void runtime.restoreModel(model).catch(() => undefined)}
                    />
                  ),
                }] : []),
              ]}
            />
          ) : (
            <div className={styles['provider-editor-empty']}>
              <span><Plus size={19} /></span>
              <strong>{t('settings.agent.providers.emptyEditor')}</strong>
              <Button type="primary" icon={<Plus size={15} />} onClick={() => navigate({ kind: 'create' })}>
                {t('settings.agent.providers.add')}
              </Button>
            </div>
          )}
        </section>
      </div>

      <AgentModelEditorDialog
        key={creatingModel ? `create:${selectedId}` : editingModel?.id ?? 'closed'}
        open={creatingModel || Boolean(editingModel)}
        provider={selectedProvider ?? (modelProviderMissing ? selectedProviderSnapshot : undefined)}
        model={editingModel}
        settings={runtime.readiness?.settings}
        busy={busy}
        conflicted={modelEditorConflict}
        modelMissing={editModelMissing}
        modelRemoved={editModelRemoved}
        providerMissing={modelProviderMissing}
        onSaveErrorVisibilityChange={setModelSaveErrorVisible}
        onCancel={() => {
          setCreatingModel(false)
          setEditModelId(undefined)
          setEditModelSnapshot(undefined)
        }}
        onResolveConflict={creatingModel
          ? async () => {
              await runtime.resolveConflict()
              return undefined
            }
          : resolveModelConflict}
        onSave={async (input, baseline) => {
          if (editModelMissing || !selectedProvider) return
          if (baseline) {
            const { remote_model_id, ...updateInput } = input
            if (!remote_model_id) return
            await runtime.saveModel(baseline, updateInput)
          } else {
            await runtime.createModel(selectedProvider, input)
          }
          setCreatingModel(false)
          setEditModelId(undefined)
          setEditModelSnapshot(undefined)
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingNavigation)}
        title={t('settings.agent.providers.discardTitle')}
        description={t('settings.agent.providers.discardDescription')}
        confirmLabel={t('settings.agent.providers.discard')}
        danger
        onCancel={() => setPendingNavigation(undefined)}
        onConfirm={() => {
          if (pendingNavigation) {
            setFormResetGeneration((current) => current + 1)
            applyNavigation(pendingNavigation)
          }
          setPendingNavigation(undefined)
        }}
      />
      <AgentModelActionDialogs
        runtime={runtime}
        removeModel={removeModel}
        testModel={testModel}
        onRemoveClose={() => setRemoveModelId(undefined)}
        onTestClose={() => setTestModelId(undefined)}
      />
      <ConfirmDialog
        open={Boolean(deleteProvider)}
        title={t('settings.agent.confirmDelete.title')}
        description={t('settings.agent.confirmDelete.description', { name: deleteProvider?.name })}
        confirmLabel={t('app.delete')}
        danger
        confirmLoading={runtime.mutation === `provider:${deleteProvider?.id}`}
        onCancel={() => setDeleteProviderId(undefined)}
        onConfirm={() => {
          if (!deleteProvider) return
          const target = deleteProvider
          setDeleteProviderId(undefined)
          void runtime.deleteProvider(target).then(() => {
            setSelectedId(undefined)
          }).catch(() => undefined)
        }}
      />
    </section>
  )
}

function Action({ title, icon, disabled, danger = false, onClick }: {
  title: string
  icon: React.ReactNode
  disabled: boolean
  danger?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip title={title} rootClassName={uiStyles.tooltip}>
      <Button
        type="text"
        icon={icon}
        aria-label={title}
        disabled={disabled}
        danger={danger}
        onClick={onClick}
      />
    </Tooltip>
  )
}

function isRequestAborted(error: unknown) {
  return error instanceof TermousApiError && error.code === 'REQUEST_ABORTED'
}
