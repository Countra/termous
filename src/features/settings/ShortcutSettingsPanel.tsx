import {
  Button,
  Empty,
  Input,
  Popconfirm,
  Tooltip,
} from 'antd'
import {
  CircleAlert,
  Keyboard,
  PencilLine,
  RotateCcw,
  Search,
} from 'lucide-react'
import {
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ShortcutActionOverride,
  ShortcutChord,
  ShortcutSettings,
} from '../../types/domain'
import {
  formatShortcutChord,
  shortcutBindingListsEqual,
  type ShortcutActionId,
  type ShortcutPlatform,
} from '../shortcuts/index.ts'
import { ShortcutRecorderModal } from './ShortcutRecorderModal.tsx'
import {
  buildShortcutSettingsRows,
  createShortcutBindingChange,
  filterShortcutSettingsRows,
  groupShortcutSettingsRows,
  shortcutActionTranslationSegment,
  shortcutScopeTranslationSegment,
  validateShortcutDraft,
  type ShortcutEditorState,
  type ShortcutSettingsRow,
} from './shortcutSettingsPanelModel.ts'
import './shortcut-settings.css'

export interface ShortcutSettingsPanelProps {
  value: ShortcutSettings
  platform: ShortcutPlatform
  disabled?: boolean
  onPatchChanges: (
    changes: Record<string, ShortcutActionOverride | null>,
  ) => Promise<void>
  onResetAll: () => Promise<void>
}

export function ShortcutSettingsPanel({
  value,
  platform,
  disabled = false,
  onPatchChanges,
  onResetAll,
}: ShortcutSettingsPanelProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<ShortcutEditorState | null>(null)
  const [busyActionIds, setBusyActionIds] = useState<Set<ShortcutActionId>>(() => new Set())
  const [failedActionIds, setFailedActionIds] = useState<Set<ShortcutActionId>>(() => new Set())
  const [resetBusy, setResetBusy] = useState(false)
  const [resetFailed, setResetFailed] = useState(false)
  const busyActionIdsRef = useRef(new Set<ShortcutActionId>())
  const resetBusyRef = useRef(false)

  const rows = useMemo(() => buildShortcutSettingsRows(value, platform), [platform, value])
  const filteredRows = useMemo(() => filterShortcutSettingsRows(
    rows,
    query,
    (row) => getShortcutSearchText(row, t),
  ), [query, rows, t])
  const groups = useMemo(() => groupShortcutSettingsRows(filteredRows), [filteredRows])
  const customizedCount = rows.filter((row) => row.customized).length
  const activeRow = editor
    ? rows.find((row) => row.definition.id === editor.actionId) ?? null
    : null
  const draftValidation = useMemo(() => (
    editor
      ? validateShortcutDraft(editor.actionId, editor.bindings, value, platform)
      : null
  ), [editor, platform, value])
  const editorDirty = Boolean(editor && activeRow && !shortcutBindingListsEqual(
    editor.bindings,
    activeRow.bindings,
  ))
  const editorBusy = editor ? busyActionIds.has(editor.actionId) : false

  const captureChord = (chord: ShortcutChord) => {
    setEditor((current) => {
      if (!current || current.recordingIndex === null) return current
      const nextBindings = current.bindings.map(copyChord)
      if (current.recordingIndex < nextBindings.length) {
        nextBindings[current.recordingIndex] = copyChord(chord)
      } else if (nextBindings.length < 2) {
        nextBindings.push(copyChord(chord))
      }
      return {
        ...current,
        bindings: nextBindings,
        recordingIndex: null,
      }
    })
  }

  const openEditor = (row: ShortcutSettingsRow) => {
    if (disabled || resetBusyRef.current || busyActionIdsRef.current.has(row.definition.id)) {
      return
    }
    setFailedActionIds((current) => removeSetValue(current, row.definition.id))
    setEditor({
      actionId: row.definition.id,
      bindings: row.bindings.map(copyChord),
      recordingIndex: row.bindings.length < 2 ? row.bindings.length : null,
    })
  }

  const closeEditor = () => {
    if (editorBusy) return
    setEditor(null)
  }

  const mutateAction = async (
    actionId: ShortcutActionId,
    operation: () => Promise<void>,
  ) => {
    if (disabled || resetBusyRef.current || busyActionIdsRef.current.has(actionId)) {
      return false
    }
    busyActionIdsRef.current.add(actionId)
    setBusyActionIds(new Set(busyActionIdsRef.current))
    setFailedActionIds((current) => removeSetValue(current, actionId))
    try {
      await operation()
      return true
    } catch {
      setFailedActionIds((current) => new Set(current).add(actionId))
      return false
    } finally {
      busyActionIdsRef.current.delete(actionId)
      setBusyActionIds(new Set(busyActionIdsRef.current))
    }
  }

  const saveEditor = async () => {
    if (!editor || !draftValidation?.valid || !editorDirty) return
    const actionId = editor.actionId
    const change = createShortcutBindingChange(actionId, editor.bindings)
    const succeeded = await mutateAction(actionId, () => onPatchChanges({
      [actionId]: change,
    }))
    if (succeeded) setEditor(null)
  }

  const restoreAction = async (actionId: ShortcutActionId) => {
    await mutateAction(actionId, () => onPatchChanges({ [actionId]: null }))
  }

  const resetAll = async () => {
    if (
      disabled
      || resetBusyRef.current
      || busyActionIdsRef.current.size > 0
      || customizedCount === 0
    ) {
      return
    }
    resetBusyRef.current = true
    setResetBusy(true)
    setResetFailed(false)
    try {
      await onResetAll()
    } catch {
      setResetFailed(true)
    } finally {
      resetBusyRef.current = false
      setResetBusy(false)
    }
  }

  return (
    <section className="settings-section shortcut-settings-panel">
      <header className="shortcut-settings-heading">
        <div className="settings-section-header shortcut-settings-title">
          <Keyboard size={18} aria-hidden="true" />
          <div>
            <h2>{t('settings.shortcuts.title')}</h2>
            <p>{t('settings.shortcuts.description')}</p>
          </div>
        </div>
        <div className="shortcut-settings-summary">
          <span>{t('settings.shortcuts.customizedCount', { count: customizedCount })}</span>
          <Popconfirm
            title={t('settings.shortcuts.resetAllTitle')}
            description={t('settings.shortcuts.resetAllDescription')}
            okText={t('settings.shortcuts.resetAllConfirm')}
            cancelText={t('settings.shortcuts.recorder.cancel')}
            placement="bottomRight"
            overlayClassName="shortcut-settings-popconfirm"
            onConfirm={() => resetAll()}
          >
            <Button
              icon={<RotateCcw size={15} aria-hidden="true" />}
              loading={resetBusy}
              disabled={disabled || resetBusy || busyActionIds.size > 0 || customizedCount === 0}
            >
              {t('settings.shortcuts.resetAll')}
            </Button>
          </Popconfirm>
        </div>
      </header>

      {resetFailed && (
        <div className="shortcut-settings-inline-error" role="status">
          <CircleAlert size={14} aria-hidden="true" />
          {t('settings.shortcuts.resetAllFailed')}
        </div>
      )}

      <div className="shortcut-settings-toolbar">
        <Input
          id="settings-shortcuts-search"
          name="shortcut-search"
          allowClear
          value={query}
          prefix={<Search size={15} aria-hidden="true" />}
          placeholder={t('settings.shortcuts.searchPlaceholder')}
          className="shortcut-settings-search"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {groups.length === 0 ? (
        <Empty
          className="shortcut-settings-empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('settings.shortcuts.emptySearch')}
        />
      ) : (
        <div className="shortcut-settings-groups">
          {groups.map(({ group, rows: groupRows }) => (
            <section className="shortcut-settings-group" key={group}>
              <div className="shortcut-settings-group-heading">
                <strong>{t(`settings.shortcuts.groups.${group}`)}</strong>
                <span>{groupRows.length}</span>
              </div>
              <div className="shortcut-settings-list">
                {groupRows.map((row) => (
                  <ShortcutSettingsRowView
                    key={row.definition.id}
                    row={row}
                    platform={platform}
                    busy={busyActionIds.has(row.definition.id)}
                    failed={failedActionIds.has(row.definition.id)}
                    disabled={disabled || resetBusy}
                    onEdit={() => openEditor(row)}
                    onRestore={() => restoreAction(row.definition.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <ShortcutRecorderModal
        row={activeRow}
        editor={editor}
        platform={platform}
        validation={draftValidation}
        busy={editorBusy}
        dirty={editorDirty}
        failed={Boolean(editor && failedActionIds.has(editor.actionId))}
        onCapture={captureChord}
        onRecord={(index) => setEditor((current) => (
          current ? { ...current, recordingIndex: index } : current
        ))}
        onStopRecording={() => setEditor((current) => (
          current ? { ...current, recordingIndex: null } : current
        ))}
        onRemove={(index) => setEditor((current) => {
          if (!current) return current
          return {
            ...current,
            bindings: current.bindings.filter((_, bindingIndex) => bindingIndex !== index),
            recordingIndex: null,
          }
        })}
        onSave={saveEditor}
        onClose={closeEditor}
      />
    </section>
  )
}

function ShortcutSettingsRowView({
  row,
  platform,
  busy,
  failed,
  disabled,
  onEdit,
  onRestore,
}: {
  row: ShortcutSettingsRow
  platform: ShortcutPlatform
  busy: boolean
  failed: boolean
  disabled: boolean
  onEdit: () => void
  onRestore: () => Promise<void>
}) {
  const { t } = useTranslation()
  const actionLabel = actionName(row, t)
  return (
    <article className={`shortcut-settings-row status-${row.status}`}>
      <div className="shortcut-settings-action-copy">
        <strong>{actionLabel}</strong>
        <small>{actionDescription(row, t)}</small>
        {failed && (
          <span className="shortcut-settings-row-error" role="status">
            {t('settings.shortcuts.binding.saveFailed')}
          </span>
        )}
        {row.conflicts.length > 0 && (
          <span className="shortcut-settings-row-warning" role="status">
            <CircleAlert size={13} aria-hidden="true" />
            {t('settings.shortcuts.conflict.ambiguous')}
          </span>
        )}
      </div>
      <div className="shortcut-settings-scope">
        {t(`settings.shortcuts.scopes.${shortcutScopeTranslationSegment(row.definition.scope)}`)}
      </div>
      <div className="shortcut-settings-bindings" aria-label={t('settings.shortcuts.recorder.captured')}>
        {row.bindings.length > 0 ? row.bindings.map((binding) => (
          <kbd key={`${binding.modifiers.join('+')}|${binding.code}`}>
            {formatShortcutChord(binding, platform)}
          </kbd>
        )) : (
          <span className="shortcut-settings-unbound">{t('settings.shortcuts.status.unbound')}</span>
        )}
      </div>
      <span className={`shortcut-settings-status is-${row.status}`}>
        {t(`settings.shortcuts.status.${row.status}`)}
      </span>
      <div className="shortcut-settings-row-actions">
        {row.customized && (
          <Popconfirm
            title={t('settings.shortcuts.binding.restoreTitle')}
            description={t('settings.shortcuts.binding.restoreDescription')}
            okText={t('settings.shortcuts.binding.restoreConfirm')}
            cancelText={t('settings.shortcuts.recorder.cancel')}
            overlayClassName="shortcut-settings-popconfirm"
            onConfirm={() => onRestore()}
          >
            <Tooltip title={t('settings.shortcuts.binding.restore')}>
              <Button
                type="text"
                icon={<RotateCcw size={14} aria-hidden="true" />}
                disabled={disabled || busy}
                aria-label={t('settings.shortcuts.binding.restore')}
              />
            </Tooltip>
          </Popconfirm>
        )}
        <Tooltip title={t('settings.shortcuts.binding.edit')}>
          <Button
            type="text"
            icon={<PencilLine size={14} aria-hidden="true" />}
            loading={busy}
            disabled={disabled || busy}
            aria-label={`${t('settings.shortcuts.binding.edit')}: ${actionLabel}`}
            onClick={onEdit}
          />
        </Tooltip>
      </div>
    </article>
  )
}

function getShortcutSearchText(
  row: ShortcutSettingsRow,
  t: (key: string) => string,
) {
  return [
    row.definition.id,
    actionName(row, t),
    actionDescription(row, t),
    t(`settings.shortcuts.groups.${row.definition.group}`),
    t(`settings.shortcuts.scopes.${shortcutScopeTranslationSegment(row.definition.scope)}`),
  ]
}

function actionName(row: ShortcutSettingsRow, t: (key: string) => string) {
  return t(`settings.shortcuts.actions.${shortcutActionTranslationSegment(row.definition.id)}.name`)
}

function actionDescription(row: ShortcutSettingsRow, t: (key: string) => string) {
  return t(`settings.shortcuts.actions.${shortcutActionTranslationSegment(row.definition.id)}.description`)
}

function copyChord(chord: ShortcutChord): ShortcutChord {
  return { ...chord, modifiers: [...chord.modifiers] }
}

function removeSetValue<T>(source: Set<T>, value: T) {
  const next = new Set(source)
  next.delete(value)
  return next
}
