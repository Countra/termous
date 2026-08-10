import { App as AntdApp, Button, Input, Tooltip } from 'antd'
import {
  ArrowDown,
  ArrowUp,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getTermousBridge } from '#shared/bridge'
import { confirmDialogStyles, EditorModeContext } from '#shared/ui'
import type {
  LocalPathMapping,
  LocalPathMappingInput,
  LocalPathMappingReorderItem,
} from '#entities/file'
import type { useLocalDownloadDrop } from '../model/useLocalDownloadDrop'
import type { LocalDownloadTarget } from '../model/types'

type DropController = ReturnType<typeof useLocalDownloadDrop>
type MappingDraft = LocalPathMappingInput & { id?: string }

interface LocalDownloadMappingPaneProps {
  open: boolean
  mappings: readonly LocalPathMapping[]
  selectedMappingId: string
  disabled?: boolean
  drop: DropController
  onSelectMapping: (mappingId: string) => void
  onCreateMapping: (input: LocalPathMappingInput) => Promise<LocalPathMapping>
  onUpdateMapping: (id: string, input: LocalPathMappingInput) => Promise<LocalPathMapping>
  onDeleteMapping: (id: string) => Promise<void>
  onReorderMappings: (items: LocalPathMappingReorderItem[]) => Promise<LocalPathMapping[]>
  onActionError: (message: string) => void
}

export function LocalDownloadMappingPane({
  open,
  mappings,
  selectedMappingId,
  disabled = false,
  drop,
  onSelectMapping,
  onCreateMapping,
  onUpdateMapping,
  onDeleteMapping,
  onReorderMappings,
  onActionError,
}: LocalDownloadMappingPaneProps) {
  const { t } = useTranslation()
  const { modal } = AntdApp.useApp()
  const [draft, setDraft] = useState<MappingDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [reordering, setReordering] = useState(false)
  const mappingNameId = useId()
  const mappingPathId = useId()
  const selectedMapping = useMemo(
    () => mappings.find((mapping) => mapping.id === selectedMappingId) ?? null,
    [mappings, selectedMappingId],
  )
  const selectedIndex = selectedMapping
    ? mappings.findIndex((mapping) => mapping.id === selectedMapping.id)
    : -1

  useEffect(() => {
    if (!open) {
      setDraft(null)
    }
  }, [open])

  const chooseDirectory = async () => {
    try {
      const filesBridge = getTermousBridge()?.files
      const paths = await filesBridge?.pickDirectory()
      const path = paths?.[0]
      if (!path) {
        return
      }
      setDraft((current) => ({
        id: current?.id,
        name: current?.name.trim() || localPathDisplayName(path),
        path,
      }))
    } catch (error) {
      onActionError(errorMessage(error, t('files.localMappingsActionFailed')))
    }
  }

  const saveDraft = async () => {
    if (!draft || saving || disabled) {
      return
    }
    const input = {
      name: draft.name.trim() || localPathDisplayName(draft.path),
      path: draft.path.trim(),
    }
    if (!input.path) {
      onActionError(t('files.localPathRequired'))
      return
    }
    setSaving(true)
    try {
      const saved = draft.id
        ? await onUpdateMapping(draft.id, input)
        : await onCreateMapping(input)
      setDraft(null)
      onSelectMapping(saved.id)
    } catch (error) {
      onActionError(errorMessage(error, t('files.localMappingsActionFailed')))
    } finally {
      setSaving(false)
    }
  }

  const moveSelectedMapping = async (direction: -1 | 1) => {
    if (!selectedMapping || selectedIndex < 0 || reordering || disabled) {
      return
    }
    const targetIndex = selectedIndex + direction
    if (targetIndex < 0 || targetIndex >= mappings.length) {
      return
    }
    const nextMappings = [...mappings]
    const [moved] = nextMappings.splice(selectedIndex, 1)
    if (!moved) {
      return
    }
    nextMappings.splice(targetIndex, 0, moved)
    setReordering(true)
    try {
      await onReorderMappings(nextMappings.map((mapping, index) => ({
        id: mapping.id,
        sort_order: index,
      })))
    } catch (error) {
      onActionError(errorMessage(error, t('files.localMappingsActionFailed')))
    } finally {
      setReordering(false)
    }
  }

  const deleteSelectedMapping = () => {
    if (!selectedMapping || disabled) {
      return
    }
    modal.confirm({
      title: t('files.deleteLocalMappingTitle'),
      content: t('files.deleteLocalMappingHint', { name: selectedMapping.name }),
      okText: t('app.delete'),
      cancelText: t('app.cancel'),
      okButtonProps: { danger: true },
      className: `${confirmDialogStyles.modal} confirm-modal`,
      rootClassName: `${confirmDialogStyles['modal-root']} termous-modal-root`,
      centered: true,
      onOk: async () => {
        try {
          await onDeleteMapping(selectedMapping.id)
          const fallback = mappings[selectedIndex + 1] ?? mappings[selectedIndex - 1]
          onSelectMapping(fallback?.id ?? '')
        } catch (error) {
          onActionError(errorMessage(error, t('files.localMappingsActionFailed')))
          throw error
        }
      },
    })
  }

  return (
    <section
      className="local-download-console-mappings"
      aria-label={t('files.downloadDestinationMappings')}
    >
      <header className="local-download-console-pane-head">
        {draft ? (
          <EditorModeContext
            mode={draft.id ? 'edit' : 'create'}
            size="compact"
            label={t(draft.id ? 'app.edit' : 'app.add')}
          />
        ) : (
          <span className="local-download-console-pane-title">
            <HardDrive size={15} aria-hidden="true" />
            {t('files.downloadDestinationMappings')}
            <small>{mappings.length}</small>
          </span>
        )}
        <div className="local-download-console-pane-actions">
          {draft ? (
            <Tooltip title={t('app.cancel')} mouseLeaveDelay={0}>
              <Button
                type="text"
                size="small"
                aria-label={t('app.cancel')}
                disabled={disabled || saving}
                icon={<X size={14} aria-hidden="true" />}
                onClick={() => setDraft(null)}
              />
            </Tooltip>
          ) : (
            <>
              <Tooltip title={t('files.addLocalMapping')} mouseLeaveDelay={0}>
                <Button
                  type="text"
                  size="small"
                  aria-label={t('files.addLocalMapping')}
                  disabled={disabled}
                  icon={<FolderPlus size={14} aria-hidden="true" />}
                  onClick={() => setDraft({ name: '', path: '' })}
                />
              </Tooltip>
              <Tooltip title={t('app.moveUp')} mouseLeaveDelay={0}>
                <Button
                  type="text"
                  size="small"
                  aria-label={t('app.moveUp')}
                  disabled={disabled || selectedIndex <= 0 || reordering}
                  icon={<ArrowUp size={14} aria-hidden="true" />}
                  onClick={() => void moveSelectedMapping(-1)}
                />
              </Tooltip>
              <Tooltip title={t('app.moveDown')} mouseLeaveDelay={0}>
                <Button
                  type="text"
                  size="small"
                  aria-label={t('app.moveDown')}
                  disabled={
                    disabled
                    || selectedIndex < 0
                    || selectedIndex >= mappings.length - 1
                    || reordering
                  }
                  icon={<ArrowDown size={14} aria-hidden="true" />}
                  onClick={() => void moveSelectedMapping(1)}
                />
              </Tooltip>
              <Tooltip title={t('app.edit')} mouseLeaveDelay={0}>
                <Button
                  type="text"
                  size="small"
                  aria-label={t('app.edit')}
                  disabled={disabled || !selectedMapping}
                  icon={<Pencil size={14} aria-hidden="true" />}
                  onClick={() => selectedMapping && setDraft({
                    id: selectedMapping.id,
                    name: selectedMapping.name,
                    path: selectedMapping.path,
                  })}
                />
              </Tooltip>
              <Tooltip title={t('app.delete')} mouseLeaveDelay={0}>
                <Button
                  type="text"
                  size="small"
                  danger
                  aria-label={t('app.delete')}
                  disabled={disabled || !selectedMapping}
                  icon={<Trash2 size={14} aria-hidden="true" />}
                  onClick={deleteSelectedMapping}
                />
              </Tooltip>
            </>
          )}
        </div>
      </header>

      {draft ? (
        <form
          className="local-download-console-mapping-form"
          onSubmit={(event) => {
            event.preventDefault()
            void saveDraft()
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || saving) {
              return
            }
            event.preventDefault()
            event.stopPropagation()
            setDraft(null)
          }}
        >
          <div className="local-download-console-mapping-form-fields">
            <label htmlFor={mappingNameId}>
              <span>{t('files.localMappingName')}</span>
              <Input
                id={mappingNameId}
                name="local-download-mapping-name"
                size="small"
                autoFocus
                value={draft.name}
                disabled={disabled || saving}
                onChange={(event) => setDraft((current) => current
                  ? { ...current, name: event.target.value }
                  : current)}
              />
            </label>
            <label htmlFor={mappingPathId}>
              <span>{t('files.localMappingPath')}</span>
              <div className="local-download-console-mapping-path-field">
                <Input
                  id={mappingPathId}
                  name="local-download-mapping-path"
                  size="small"
                  value={draft.path}
                  disabled={disabled || saving}
                  onChange={(event) => setDraft((current) => current
                    ? { ...current, path: event.target.value }
                    : current)}
                />
                <Tooltip title={t('files.chooseLocalDirectory')} mouseLeaveDelay={0}>
                  <Button
                    className="local-download-console-mapping-picker"
                    htmlType="button"
                    type="text"
                    size="small"
                    aria-label={t('files.chooseLocalDirectory')}
                    disabled={disabled || saving}
                    icon={<FolderOpen size={14} aria-hidden="true" />}
                    onClick={() => void chooseDirectory()}
                  />
                </Tooltip>
              </div>
            </label>
          </div>
          <footer className="local-download-console-mapping-form-actions">
            <Button
              type="text"
              size="small"
              disabled={disabled || saving}
              onClick={() => setDraft(null)}
            >
              {t('app.cancel')}
            </Button>
            <Button
              htmlType="submit"
              type="primary"
              size="small"
              loading={saving}
              disabled={disabled}
              icon={draft.id
                ? <Save size={13} aria-hidden="true" />
                : <Plus size={13} aria-hidden="true" />}
            >
              {draft.id ? t('app.save') : t('app.create')}
            </Button>
          </footer>
        </form>
      ) : (
        <div className="local-download-console-mapping-list">
          {mappings.length > 0 ? mappings.map((mapping) => {
            const target = mappingTarget(mapping)
            const targetKey = `mapping:${mapping.id}`
            return (
              <Button
                key={mapping.id}
                type="text"
                htmlType="button"
                block
                className={[
                  'local-download-console-mapping-row',
                  selectedMappingId === mapping.id ? 'is-active' : '',
                  mapping.available ? '' : 'is-unavailable',
                  drop.activeDropTarget === targetKey ? 'is-drop-target' : '',
                  drop.busyDropTarget === targetKey ? 'is-drop-busy' : '',
                ].filter(Boolean).join(' ')}
                disabled={disabled}
                aria-pressed={selectedMappingId === mapping.id}
                onClick={() => onSelectMapping(mapping.id)}
                onDragOver={(event) => drop.onTargetDragOver(targetKey, target, event)}
                onDragLeave={(event) => drop.onTargetDragLeave(targetKey, event)}
                onDrop={(event) => void drop.onTargetDrop(targetKey, target, event)}
              >
                <span className="local-download-console-row-icon" aria-hidden="true">
                  <HardDrive size={15} />
                </span>
                <span className="local-download-console-row-copy">
                  <strong>{mapping.name}</strong>
                  <small>{mapping.path}</small>
                </span>
                <span
                  className="local-download-console-mapping-status"
                  aria-label={mapping.available
                    ? t('status.available')
                    : t('files.downloadDestinationUnavailable')}
                >
                  <i aria-hidden="true" />
                </span>
              </Button>
            )
          }) : (
            <div className="local-download-console-empty-copy">
              <HardDrive size={20} aria-hidden="true" />
              <strong>{t('files.noLocalMappings')}</strong>
              <span>{t('files.noLocalMappingsHint')}</span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function mappingTarget(mapping: LocalPathMapping): LocalDownloadTarget {
  return {
    mappingId: mapping.id,
    mappingName: mapping.name,
    mappingPath: mapping.path,
    path: mapping.path,
    available: mapping.available,
  }
}

function localPathDisplayName(path: string) {
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || trimmed || path
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}
