import { useEffect, useMemo, useState } from 'react'
import { App as AntdApp, Button, Tabs, Tooltip } from 'antd'
import { Boxes, Settings2, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentModel, AgentModelProvider } from '#entities/agent'
import { SettingsEditorContext, useSettingsEditor, type SettingsEditor } from '#entities/settings'
import { ConfirmDialog, SettingsSaveBar, termousNotificationClassName, uiStyles } from '#shared/ui'
import {
  AgentProviderProvisionError,
  type AgentSetupController,
} from '../model/useAgentSetupController.ts'
import { AgentModelEditor } from './AgentModelEditor.tsx'
import { AgentModelCatalog } from './AgentModelCatalog.tsx'
import { AgentModelActionDialogs } from './AgentModelActionDialogs.tsx'
import { AgentProviderConnectionForm } from './AgentProviderConnectionForm.tsx'
import { AgentProviderHeader } from './model-services/AgentProviderHeader.tsx'
import { AgentServiceNotice } from './model-services/AgentServiceNotice.tsx'
import { useAgentDefaultModelDraft } from '../model/useAgentDefaultModelDraft.ts'
import { useAgentProviderActions } from '../model/useAgentProviderActions.ts'
import styles from './AgentProviderManager.module.scss'

type PendingNavigation =
  | { kind: 'create' }
  | { kind: 'provider'; id: string }
  | { kind: 'tab'; tab: 'connection' | 'catalog' }
  | { kind: 'model'; model?: AgentModel }

export function AgentProviderManager({
  runtime,
  onEditorConflictVisibilityChange,
  onErrorVisibilityChange,
}: {
  runtime: AgentSetupController
  onEditorConflictVisibilityChange: (visible: boolean) => void
  onErrorVisibilityChange: (visible: boolean) => void
}) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const [selectedId, setSelectedId] = useState<string | undefined>(() => runtime.providers[0]?.id)
  const [creating, setCreating] = useState(() => runtime.providers.length === 0)
  const [activeTab, setActiveTab] = useState<'connection' | 'catalog'>('connection')
  const [editor, setEditor] = useState<SettingsEditor | null>(null)
  const defaultModelDraft = useAgentDefaultModelDraft(runtime)
  const activeEditor = editor ?? defaultModelDraft.editor
  const dirty = activeEditor.dirty
  const [saved, setSaved] = useState(false)
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
  const { testProvider, refreshProvider, testingProviderId, refreshingProviderId } = useAgentProviderActions(runtime, () => setProvisionFailure(undefined))
  const [modelSaveError, setModelSaveError] = useState<unknown>(null)
  const [providerSaveError, setProviderSaveError] = useState<unknown>(null)
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
  const pageEditor: SettingsEditor = {
    dirty, busy: busy || activeEditor.busy || Boolean(pendingNavigation || deleteProviderId || removeModelId || testModelId),
    invalid: activeEditor.invalid, saving: activeEditor.saving ?? false, ready: Boolean(runtime.readiness), saved,
    save: () => activeEditor.save(), reset: () => { activeEditor.reset(); setSaved(false) },
  }
  const managed = useSettingsEditor(pageEditor)

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
    if (pageEditor.busy) return
    if (target.kind === 'provider' && !creating && target.id === selectedId && !creatingModel && !editModelId) return
    if (target.kind === 'tab' && target.tab === activeTab && !creatingModel && !editModelId) return
    if (dirty) {
      setPendingNavigation(target)
      return
    }
    applyNavigation(target)
  }

  const applyNavigation = (target: PendingNavigation) => {
    setProvisionFailure(undefined)
    setFormResetGeneration(current => current + 1)
    setEditor(null)
    defaultModelDraft.reset()
    setSaved(false)
    setCreatingModel(false)
    setEditModelId(undefined)
    setEditModelSnapshot(undefined)
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
    if (target.kind === 'model') {
      setCreatingModel(!target.model)
      setEditModelId(target.model?.id)
      setEditModelSnapshot(target.model)
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
    if (!relevantConflict) {
      const latest = modelById.get(editingModel.id)
      return latest ? { model: latest } : undefined
    }
    const snapshot = await runtime.resolveConflict()
    const latest = snapshot?.models.find(({ id }) => id === editingModel.id)
    return latest ? { model: latest } : undefined
  }

  const saveProvider = async (
    input: Parameters<typeof runtime.saveProvider>[0],
    baseline?: AgentModelProvider,
  ) => {
    try {
      const saved = await runtime.saveProvider(input, baseline)
      setSelectedId(saved.id)
      setCreating(false)
      setSaved(true)
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
        setSaved(true)
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
  const providerSaveErrorVisible = Boolean(
    !creatingModel && !editModelId && (creating || activeTab === 'connection') && providerSaveError && runtime.error === providerSaveError,
  )
  const modelSaveErrorVisible = Boolean(
    (creatingModel || editingModel) && modelSaveError && runtime.error === modelSaveError,
  )
  useEffect(() => {
    onEditorConflictVisibilityChange(Boolean(
      providerEditorConflict || modelEditorConflict || defaultModelDraft.conflicted,
    ))
  }, [defaultModelDraft.conflicted, modelEditorConflict, onEditorConflictVisibilityChange, providerEditorConflict])
  useEffect(() => {
    onErrorVisibilityChange(modelSaveErrorVisible || providerSaveErrorVisible)
  }, [modelSaveErrorVisible, onErrorVisibilityChange, providerSaveErrorVisible])
  const providerContainsDefault = Boolean(selectedProvider && runtime.models.some((model) => (
    model.provider_id === selectedProvider.id
    && model.id === runtime.readiness?.settings.default_model_id
  )))

  const editingModelOpen = creatingModel || Boolean(editingModel)
  const tabItems = [
    { key: 'connection', disabled: busy, label: <span className={styles['provider-tab-label']}><Settings2 size={14} aria-hidden="true" />{t('settings.agent.providers.connectionTab')}</span> },
    { key: 'catalog', disabled: busy || creating, label: <span className={styles['provider-tab-label']}><Boxes size={14} aria-hidden="true" />{t('settings.agent.providers.catalogTab')}
      {!creating && <small aria-hidden="true">{modelCounts.get(selectedId ?? '') ?? 0}</small>}</span> },
  ]

  return (
    <section className={styles['provider-management-surface']} role="region" aria-label={t('settings.agent.providers.title')}>
      {!editingModelOpen && <AgentProviderHeader providers={runtime.providers} provider={editingProvider}
        creating={creating} disabled={pageEditor.busy} loading={runtime.loading} modelCounts={modelCounts}
        onSelect={id => navigate({ kind: 'provider', id })} onCreate={() => navigate({ kind: 'create' })}
        onRefresh={() => void runtime.load()}
        onBack={creating && runtime.providers.length > 0
          ? () => navigate({ kind: 'provider', id: selectedProvider?.id ?? runtime.providers[0].id })
          : undefined} />}
      {defaultModelDraft.conflicted && <AgentServiceNotice type="warning" title={t('settings.agent.conflict.title')}
        description={t('settings.agent.conflict.editorDescription')}
        action={<Button size="small" loading={busy} onClick={() => void defaultModelDraft.refresh()}>{t('settings.agent.conflict.refresh')}</Button>} />}
      {defaultModelDraft.unavailable && <AgentServiceNotice type="warning" title={t('settings.agent.catalog.pendingDefaultUnavailable')} />}
      <SettingsEditorContext.Provider value={setEditor}>
        {editingModelOpen && <AgentModelEditor
          key={creatingModel ? `create:${selectedId}` : editingModel?.id}
          provider={selectedProvider ?? (modelProviderMissing ? selectedProviderSnapshot : undefined)}
          model={editingModel} settings={runtime.readiness?.settings} busy={busy}
          conflicted={modelEditorConflict} modelMissing={editModelMissing} modelRemoved={editModelRemoved}
          providerMissing={modelProviderMissing} conflictError={modelEditorConflict ? runtime.error : undefined}
          onSaveErrorChange={setModelSaveError}
          refreshing={runtime.loading} onRefresh={() => void runtime.load()}
          onCancel={() => navigate({ kind: 'tab', tab: 'catalog' })}
          onResolveConflict={creatingModel
            ? async () => {
                const snapshot = await runtime.resolveConflict()
                return snapshot?.providers.some(({ id }) => id === selectedId) ? {} : undefined
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
            setSaved(true)
            setCreatingModel(false)
            setEditModelId(undefined)
            setEditModelSnapshot(undefined)
          }}
        />}
        <div hidden={editingModelOpen} inert={editingModelOpen}>
          {!creating && <div className={styles['provider-section-navigation']}>
            <Tabs activeKey={activeTab} className={styles['provider-tabs']}
              onChange={key => navigate({ kind: 'tab', tab: key as 'connection' | 'catalog' })} items={tabItems} />
            {selectedProvider && !creating ? <Action
              title={t(providerContainsDefault ? 'settings.agent.providers.deleteDefaultBlocked' : 'app.delete')}
              icon={<Trash2 size={15} />} disabled={busy || dirty || providerContainsDefault} danger
              onClick={() => setDeleteProviderId(selectedProvider.id)}
            /> : null}
          </div>}
          {creating || activeTab === 'connection' ? <div role="tabpanel" aria-label={t('settings.agent.providers.connectionTab')}>
            <AgentProviderConnectionForm
              key={`${creating ? 'create' : editingProvider?.id ?? 'missing'}:${formResetGeneration}`}
              provider={creating ? undefined : editingProvider} busy={busy}
              conflicted={Boolean(providerEditorConflict)} providerMissing={selectedProviderMissing}
              provisionFailure={provisionFailure} testing={testingProviderId === selectedProvider?.id}
              focusRequest={creating ? createFocusGeneration : 0}
              onResolveConflict={resolveProviderConflict} onSave={saveProvider}
              onSaveErrorChange={setProviderSaveError}
              onTest={() => selectedProvider ? testProvider(selectedProvider) : Promise.resolve()}
            />
          </div> : selectedProvider ? <div role="tabpanel" aria-label={t('settings.agent.providers.catalogTab')}>
            <AgentModelCatalog key={selectedProvider.id} provider={selectedProvider} models={providerModels}
              defaultModelId={runtime.readiness?.settings.default_model_id} pendingDefaultModelId={defaultModelDraft.pendingId} disabled={busy}
              refreshing={refreshingProviderId === selectedProvider.id}
              onRefresh={() => void refreshProvider(selectedProvider).catch(() => undefined)}
              onAdd={() => navigate({ kind: 'model' })} onEdit={model => navigate({ kind: 'model', model })}
              onTest={model => setTestModelId(model.id)}
              onSetDefault={model => defaultModelDraft.select(model.id)}
              onRemove={model => setRemoveModelId(model.id)}
              onRestore={model => void runtime.restoreModel(model).catch(() => undefined)}
            />
          </div> : null}
        </div>
      </SettingsEditorContext.Provider>
      {!managed && <SettingsSaveBar {...pageEditor} onSave={pageEditor.save} onReset={pageEditor.reset} />}

      <ConfirmDialog
        open={Boolean(pendingNavigation)}
        title={t(editingModelOpen ? 'settings.agent.modelEditor.discardTitle' : 'settings.agent.providers.discardTitle')}
        description={t(editingModelOpen ? 'settings.agent.modelEditor.discardDescription' : 'settings.agent.providers.discardDescription')}
        confirmLabel={t('settings.agent.providers.discard')}
        danger
        onCancel={() => setPendingNavigation(undefined)}
        onConfirm={() => {
          if (pendingNavigation) {
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
