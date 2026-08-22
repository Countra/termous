import { Alert, App as AntdApp, Button, Input, Modal, Segmented, Select, Tooltip } from 'antd'
import {
  CircleAlert,
  CopyPlus,
  FilePlus2,
  LibraryBig,
  ListRestart,
  LoaderCircle,
  Save,
  ScanSearch,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { customSelectStyles, termousNotificationClassName } from '#shared/ui'
import { useAdvancedRenameController } from '../controller/useAdvancedRenameController'
import type { AdvancedRenameModalProps } from '../model/types'
import { AdvancedRenamePreviewPane } from './AdvancedRenamePreviewPane'
import { AdvancedRenameResultPane } from './AdvancedRenameResultPane'
import { AdvancedRenameRulePane } from './AdvancedRenameRulePane'
import styles from './AdvancedRenameModal.module.scss'

function operationActive(status?: string) {
  return status === 'queued' || status === 'running'
}

export function AdvancedRenameModal(props: AdvancedRenameModalProps) {
  const { open, source, onClose } = props
  const { t } = useTranslation()
  const { modal, notification } = AntdApp.useApp()
  const controller = useAdvancedRenameController(props)
  const [presetQuery, setPresetQuery] = useState('')
  const [mobilePane, setMobilePane] = useState<'rules' | 'preview'>('rules')
  const busy = controller.executionSubmitting || operationActive(controller.executionTask?.status)
  const reviewingResult = Boolean(controller.executionResult)
  const editingLocked = busy || reviewingResult
  const presetOptions = controller.presets
    .filter((preset) => !presetQuery || preset.name.toLocaleLowerCase().includes(presetQuery.toLocaleLowerCase()))
    .map((preset) => ({
      value: preset.id,
      label: preset.name,
      description: preset.description,
      ruleCount: preset.rules.length,
    }))

  useEffect(() => {
    if (reviewingResult) {
      setMobilePane('preview')
    }
  }, [reviewingResult])

  const requestClose = () => {
    if (busy) return
    if (!controller.draftDirty) {
      onClose()
      return
    }
    modal.confirm({
      title: t('files.advancedRename.unsavedTitle'),
      content: t('files.advancedRename.unsavedDescription'),
      okText: t('files.advancedRename.discard'),
      cancelText: t('app.cancel'),
      okButtonProps: { danger: true },
      className: 'termous-modal confirm-modal',
      rootClassName: `${styles['confirm-root']} termous-modal-root`,
      onOk: onClose,
    })
  }

  const selectPreset = (presetId?: string) => {
    setPresetQuery('')
    const apply = () => controller.applyPreset(
      controller.presets.find((preset) => preset.id === presetId) ?? null,
    )
    if (!controller.draftDirty) {
      apply()
      return
    }
    modal.confirm({
      title: t('files.advancedRename.switchPresetTitle'),
      content: t('files.advancedRename.unsavedDescription'),
      okText: t('files.advancedRename.discard'),
      cancelText: t('app.cancel'),
      okButtonProps: { danger: true },
      className: 'termous-modal confirm-modal',
      rootClassName: `${styles['confirm-root']} termous-modal-root`,
      onOk: apply,
    })
  }

  const saveAsPreset = () => {
    let name = ''
    let description = ''
    modal.confirm({
      title: t('files.advancedRename.preset.saveAs'),
      icon: null,
      content: (
        <div className={styles['preset-dialog-fields']}>
          <label><span>{t('files.advancedRename.preset.name')}</span><Input autoFocus onChange={(event) => { name = event.target.value }} /></label>
          <label><span>{t('files.advancedRename.preset.description')}</span><Input.TextArea rows={3} onChange={(event) => { description = event.target.value }} /></label>
        </div>
      ),
      okText: t('app.save'),
      cancelText: t('app.cancel'),
      className: 'termous-modal confirm-modal',
      rootClassName: `${styles['confirm-root']} termous-modal-root`,
      onOk: async () => {
        try {
          if (!name.trim()) throw new Error(t('files.advancedRename.preset.nameRequired'))
          await controller.savePreset(name, description)
        } catch (error) {
          notification.error({
            title: t('files.advancedRename.preset.failed'),
            description: error instanceof Error ? error.message : String(error),
            className: termousNotificationClassName,
          })
          throw error
        }
      },
    })
  }

  const deletePreset = () => {
    if (!controller.selectedPreset) return
    modal.confirm({
      title: t('files.advancedRename.preset.deleteTitle'),
      content: t('files.advancedRename.preset.deleteDescription', { name: controller.selectedPreset.name }),
      okText: t('app.delete'),
      cancelText: t('app.cancel'),
      okButtonProps: { danger: true },
      className: 'termous-modal confirm-modal',
      rootClassName: `${styles['confirm-root']} termous-modal-root`,
      onOk: async () => {
        try {
          await controller.deletePreset()
        } catch (error) {
          notification.error({
            title: t('files.advancedRename.preset.failed'),
            description: error instanceof Error ? error.message : String(error),
            className: termousNotificationClassName,
          })
          throw error
        }
      },
    })
  }

  const cancelExecution = async () => {
    try {
      await controller.cancelExecution()
    } catch (error) {
      notification.error({
        title: t('files.advancedRename.cancelFailed'),
        description: error instanceof Error ? error.message : String(error),
        className: termousNotificationClassName,
      })
    }
  }

  return (
    <Modal
      open={open}
      centered
      destroyOnHidden
      width={1180}
      footer={null}
      title={t('files.advancedRename.title')}
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: !busy }}
      className={styles.modal}
      rootClassName={`${styles['modal-root']} termous-modal-root`}
      onCancel={requestClose}
    >
      <section className={styles.dialog} aria-label={t('files.advancedRename.title')}>
        <header className={styles.header}>
          <span className={styles['header-icon']} aria-hidden="true"><ListRestart size={20} /></span>
          <span className={styles['header-copy']}>
            <strong>{t('files.advancedRename.title')}</strong>
            <span>{t('files.advancedRename.description', { count: source?.entries.length ?? 0 })}</span>
          </span>
          <span className={styles['source-summary']}>
            <small>{t('files.advancedRename.directory')}</small>
            <code title={source?.directory}>{source?.directory ?? '/'}</code>
          </span>
        </header>

        <div className={styles['preset-bar']}>
          <span className={styles['preset-label']}>
            <LibraryBig size={15} aria-hidden="true" />
            <span>{t('files.advancedRename.preset.toolbarLabel')}</span>
          </span>
          <Select
            allowClear
            showSearch
            className={customSelectStyles.select}
            classNames={{ popup: { root: `${customSelectStyles['select-popup']} ${styles['control-popup']}` } }}
            aria-label={t('files.advancedRename.preset.toolbarLabel')}
            value={controller.selectedPresetId || undefined}
            loading={controller.presetsLoading}
            disabled={editingLocked || controller.presetSaving}
            placeholder={t('files.advancedRename.preset.select')}
            placement="bottomRight"
            options={presetOptions}
            filterOption={false}
            searchValue={presetQuery}
            onSearch={setPresetQuery}
            onChange={(value) => selectPreset(value)}
            optionRender={(option) => {
              const label = String(option.data.label)
              const description = String(option.data.description || '')
              const content = (
                <span
                  className={styles['preset-option']}
                  aria-label={description ? `${label}: ${description}` : label}
                >
                  <strong>{label}</strong>
                  <small>{t('files.advancedRename.preset.ruleCount', { count: Number(option.data.ruleCount) })}</small>
                </span>
              )
              return description ? (
                <Tooltip
                  title={description}
                  placement="right"
                  mouseEnterDelay={0.35}
                  mouseLeaveDelay={0}
                  zIndex={3700}
                >
                  {content}
                </Tooltip>
              ) : content
            }}
          />
          {controller.presetDirty ? <span className={styles['preset-dirty']}>{t('files.advancedRename.preset.modified')}</span> : null}
          <div className={styles['preset-actions']}>
            <Tooltip title={t('files.advancedRename.preset.newDraft')}>
              <Button
                type="text"
                disabled={editingLocked || controller.presetSaving}
                aria-label={t('files.advancedRename.preset.newDraft')}
                icon={<FilePlus2 size={14} />}
                onClick={() => selectPreset(undefined)}
              />
            </Tooltip>
            <Tooltip title={t('files.advancedRename.preset.saveAs')}>
              <Button type="text" disabled={editingLocked || controller.presetsLoading || controller.presetSaving || !controller.variableDefinitionsValid} aria-label={t('files.advancedRename.preset.saveAs')} icon={<CopyPlus size={14} />} onClick={saveAsPreset} />
            </Tooltip>
            <Tooltip title={t('files.advancedRename.preset.update')}>
              <Button
                type="text"
                disabled={editingLocked || controller.presetSaving || !controller.selectedPreset || !controller.presetDirty || !controller.variableDefinitionsValid}
                aria-label={t('files.advancedRename.preset.update')}
                icon={<Save size={14} />}
                onClick={() => void controller.updatePreset().catch(() => undefined)}
              />
            </Tooltip>
            <Tooltip title={t('files.advancedRename.preset.delete')}>
              <Button type="text" danger disabled={editingLocked || controller.presetSaving || !controller.selectedPreset} aria-label={t('files.advancedRename.preset.delete')} icon={<Trash2 size={14} />} onClick={deletePreset} />
            </Tooltip>
          </div>
        </div>
        {controller.presetError ? <Alert type="error" showIcon title={t('files.advancedRename.preset.failed')} description={controller.presetError} /> : null}
        {!controller.variableDefinitionsValid ? (
          <Alert
            type="warning"
            showIcon
            title={t('files.advancedRename.variables.invalidSummary', {
              count: controller.variableDefinitionErrors.filter(Boolean).length,
            })}
          />
        ) : null}
        {controller.variableDefinitionsValid && controller.missingRequiredVariables.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            title={t('files.advancedRename.variables.requiredMissingSummary', {
              count: controller.missingRequiredVariables.length,
            })}
          />
        ) : null}

        <Segmented
          block
          className={styles['mobile-pane-switch']}
          value={mobilePane}
          aria-label={t('files.advancedRename.mobilePane')}
          options={[
            { value: 'rules', label: t('files.advancedRename.rules.title'), icon: <ListRestart size={13} /> },
            {
              value: 'preview',
              label: t(reviewingResult
                ? 'files.advancedRename.result.title'
                : 'files.advancedRename.preview.title'),
              icon: <ScanSearch size={13} />,
            },
          ]}
          onChange={(value) => setMobilePane(value as 'rules' | 'preview')}
        />
        <div className={styles.workspace} data-mobile-pane={mobilePane}>
          <AdvancedRenameRulePane
            rules={controller.rules}
            order={controller.order}
            variableDefinitions={controller.variableDefinitions}
            variables={controller.variables}
            variableDefinitionErrors={controller.variableDefinitionErrors}
            ruleDiagnostics={controller.ruleDiagnostics}
            disabled={editingLocked}
            onAddRule={controller.addRule}
            onUpdateRule={controller.updateRule}
            onRemoveRule={controller.removeRule}
            onDuplicateRule={controller.duplicateRule}
            onMoveRule={controller.moveRule}
            onOrderChange={controller.setOrder}
            onVariableDefinitionsChange={controller.setVariableDefinitions}
            onVariablesChange={controller.setVariables}
          />
          {controller.executionResult ? (
            <AdvancedRenameResultPane
              result={controller.executionResult}
              disabled={busy}
              onContinueEditing={() => {
                controller.continueEditing()
                setMobilePane('rules')
              }}
            />
          ) : (
            <AdvancedRenamePreviewPane
              preview={controller.preview}
              loading={controller.previewLoading}
              error={controller.previewError}
              excludedPaths={controller.excludedPaths}
              manualOverrides={controller.manualOverrides}
              disabled={busy}
              onToggleExcluded={controller.toggleExcluded}
              onManualOverride={controller.setManualOverride}
              onClearManualOverride={controller.clearManualOverride}
            />
          )}
        </div>

        {controller.executionTask ? (
          <ExecutionProgress
            task={controller.executionTask}
            cancelling={controller.cancelling}
            onCancel={() => void cancelExecution()}
          />
        ) : null}
        {controller.executionError ? <Alert type="error" showIcon title={t('files.advancedRename.executeFailed')} description={controller.executionError} /> : null}
        {controller.executionResult?.partial ? (
          <Alert
            type="warning"
            showIcon
            title={t('files.advancedRename.partialTitle')}
            description={t(controller.executionResult.uncertain
              ? 'files.advancedRename.uncertainDescription'
              : 'files.advancedRename.partialDescription', { ...controller.executionResult.summary })}
          />
        ) : null}

        <footer className={styles.actions}>
          <Button disabled={busy} onClick={requestClose}>{t(reviewingResult ? 'app.close' : 'app.cancel')}</Button>
          {!reviewingResult ? (
            <Button
              type="primary"
              icon={<ListRestart size={14} />}
              disabled={!controller.canExecute}
              loading={controller.executionSubmitting || (busy && !controller.cancelling)}
              onClick={() => void controller.execute()}
            >
              {t('files.advancedRename.execute', { count: controller.preview?.summary.changed ?? 0 })}
            </Button>
          ) : null}
        </footer>
      </section>
    </Modal>
  )
}

function ExecutionProgress({
  task,
  cancelling,
  onCancel,
}: {
  task: NonNullable<ReturnType<typeof useAdvancedRenameController>['executionTask']>
  cancelling: boolean
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const total = task.total_items ?? 0
  const completed = task.completed_items ?? 0
  const progress = Math.max(0, Math.min(100, task.progress_percent || (total > 0 ? (completed / total) * 100 : 0)))
  const active = operationActive(task.status)
  return (
    <div className={styles['execution-progress']} role="status" aria-live="polite">
      <span className={styles['execution-icon']}><LoaderCircle className={active ? styles.spinning : ''} size={16} /></span>
      <span className={styles['execution-copy']}>
        <strong>{t(cancelling ? 'files.advancedRename.cancelling' : 'files.advancedRename.executing')}</strong>
        <small>{task.phase_label || t('files.advancedRename.progressItems', { completed, total })}</small>
      </span>
      <span className={styles['execution-percent']}>{Math.round(progress)}%</span>
      <span className={styles['execution-bar']}><i style={{ width: `${progress}%` }} /></span>
      {active && task.cancellable ? (
        <Tooltip title={t('app.cancel')}>
          <Button type="text" danger disabled={cancelling} aria-label={t('app.cancel')} icon={<X size={14} />} onClick={onCancel} />
        </Tooltip>
      ) : null}
      {task.partial ? <CircleAlert size={14} className={styles['execution-warning']} /> : null}
    </div>
  )
}
