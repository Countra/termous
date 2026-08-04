import { Button, Modal, Popconfirm } from 'antd'
import {
  CircleAlert,
  Keyboard,
  PencilLine,
  Plus,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { ShortcutChord } from '../../types/domain'
import {
  applyShortcutDispatchResult,
  formatShortcutChord,
  normalizeKeyboardEventToChord,
  type ShortcutPlatform,
} from '../shortcuts/index.ts'
import { useShortcutRuntime } from '../shortcuts/shortcutRuntimeContext.ts'
import {
  shortcutActionTranslationSegment,
  type ShortcutDraftValidation,
  type ShortcutEditorState,
  type ShortcutSettingsRow,
} from './shortcutSettingsPanelModel.ts'

interface ShortcutRecorderModalProps {
  row: ShortcutSettingsRow | null
  editor: ShortcutEditorState | null
  platform: ShortcutPlatform
  validation: ShortcutDraftValidation | null
  busy: boolean
  dirty: boolean
  failed: boolean
  onCapture: (chord: ShortcutChord) => void
  onRecord: (index: number) => void
  onStopRecording: () => void
  onRemove: (index: number) => void
  onSave: () => Promise<void>
  onClose: () => void
}

const recorderId = 'shortcut-settings.recorder'

export function ShortcutRecorderModal({
  row,
  editor,
  platform,
  validation,
  busy,
  dirty,
  failed,
  onCapture,
  onRecord,
  onStopRecording,
  onRemove,
  onSave,
  onClose,
}: ShortcutRecorderModalProps) {
  const { t } = useTranslation()
  const { runtime } = useShortcutRuntime()
  const recorderTargetRef = useRef<HTMLButtonElement | null>(null)
  const captureChord = useCallback((event: Parameters<typeof normalizeKeyboardEventToChord>[0]) => {
    const chord = normalizeKeyboardEventToChord(event, {
      platform,
      mapPrimaryModifier: true,
      allowDefaultPrevented: true,
    })
    if (chord) onCapture(chord)
  }, [onCapture, platform])

  useEffect(() => {
    if (!editor || editor.recordingIndex === null) return undefined
    recorderTargetRef.current?.focus({ preventScroll: true })
    return runtime.pushRecorder({
      id: recorderId,
      capture: (event) => {
        captureChord(event)
        return 'blocked'
      },
    })
  }, [captureChord, editor, runtime])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!editor || editor.recordingIndex === null) return
    const result = runtime.dispatch(event.nativeEvent, {
      adapterId: recorderId,
      contextIds: [],
      editable: true,
    })
    applyShortcutDispatchResult(event, result, true)
  }

  return (
    <Modal
      open={Boolean(editor && row)}
      title={row ? t('settings.shortcuts.recorder.title', {
        action: shortcutActionName(row, t),
      }) : ''}
      width={548}
      centered
      destroyOnHidden
      className="shortcut-recorder-modal"
      rootClassName="shortcut-recorder-modal-root"
      mask={{ closable: !busy && editor?.recordingIndex === null }}
      keyboard={editor?.recordingIndex === null}
      okText={t('settings.shortcuts.recorder.save')}
      cancelText={t('settings.shortcuts.recorder.cancel')}
      okButtonProps={{
        disabled: !dirty || !validation?.valid || busy,
        loading: busy,
      }}
      cancelButtonProps={{ disabled: busy }}
      onOk={() => void onSave()}
      onCancel={onClose}
      modalRender={(node) => (
        <div
          data-shortcut-adapter="recorder"
          onKeyDownCapture={handleKeyDown}
          onKeyUpCapture={(event) => runtime.releaseKey(event.code)}
        >
          {node}
        </div>
      )}
    >
      {editor && row && validation && (
        <ShortcutRecorderBody
          row={row}
          editor={editor}
          platform={platform}
          validation={validation}
          failed={failed}
          recorderTargetRef={recorderTargetRef}
          onRecord={onRecord}
          onStopRecording={onStopRecording}
          onRemove={onRemove}
        />
      )}
    </Modal>
  )
}

function ShortcutRecorderBody({
  row,
  editor,
  platform,
  validation,
  failed,
  recorderTargetRef,
  onRecord,
  onStopRecording,
  onRemove,
}: {
  row: ShortcutSettingsRow
  editor: ShortcutEditorState
  platform: ShortcutPlatform
  validation: ShortcutDraftValidation
  failed: boolean
  recorderTargetRef: RefObject<HTMLButtonElement | null>
  onRecord: (index: number) => void
  onStopRecording: () => void
  onRemove: (index: number) => void
}) {
  const { t } = useTranslation()
  const conflicts = [...new Set(validation.conflicts.map((conflict) => {
    const otherId = conflict.firstActionId === editor.actionId
      ? conflict.secondActionId
      : conflict.firstActionId
    return t(`settings.shortcuts.actions.${shortcutActionTranslationSegment(otherId)}.name`)
  }))]

  return (
    <div className="shortcut-recorder-body">
      <p className="shortcut-recorder-intro">{t('settings.shortcuts.recorder.description')}</p>

      <div className="shortcut-recorder-bindings">
        <div className="shortcut-recorder-section-label">
          <span>{t('settings.shortcuts.recorder.captured')}</span>
          <small>{editor.bindings.length}/2</small>
        </div>
        {editor.bindings.length === 0 ? (
          <div className="shortcut-recorder-empty">{t('settings.shortcuts.binding.none')}</div>
        ) : editor.bindings.map((binding, index) => (
          <div className="shortcut-recorder-binding" key={`${index}-${binding.code}`}>
            <kbd>{formatShortcutChord(binding, platform)}</kbd>
            <span>{t('settings.shortcuts.binding.slot', { index: index + 1 })}</span>
            <Button
              type="text"
              size="small"
              icon={<PencilLine size={14} aria-hidden="true" />}
              aria-label={t('settings.shortcuts.binding.edit')}
              onClick={() => onRecord(index)}
            />
            <Popconfirm
              title={t('settings.shortcuts.binding.removeTitle')}
              description={t('settings.shortcuts.binding.removeDescription')}
              okText={t('settings.shortcuts.binding.removeConfirm')}
              cancelText={t('settings.shortcuts.recorder.cancel')}
              placement="topRight"
              overlayClassName="shortcut-settings-popconfirm"
              onConfirm={() => onRemove(index)}
            >
              <Button
                type="text"
                size="small"
                danger
                disabled={editor.recordingIndex !== null}
                icon={<X size={14} aria-hidden="true" />}
                aria-label={t('settings.shortcuts.binding.remove')}
              />
            </Popconfirm>
          </div>
        ))}
      </div>

      {editor.recordingIndex !== null ? (
        <button
          ref={recorderTargetRef}
          type="button"
          className="shortcut-recorder-target is-recording"
          onClick={onStopRecording}
        >
          <span className="shortcut-recorder-target-icon">
            <Keyboard size={20} aria-hidden="true" />
          </span>
          <span>
            <strong>{t('settings.shortcuts.recorder.listening')}</strong>
            <small>{t('settings.shortcuts.recorder.listeningHint')}</small>
          </span>
          <span className="shortcut-recorder-stop">{t('settings.shortcuts.recorder.cancel')}</span>
        </button>
      ) : editor.bindings.length < 2 ? (
        <Button
          block
          className="shortcut-recorder-add"
          icon={<Plus size={15} aria-hidden="true" />}
          onClick={() => onRecord(editor.bindings.length)}
        >
          {t('settings.shortcuts.binding.add')}
        </Button>
      ) : (
        <div className="shortcut-recorder-limit">{t('settings.shortcuts.recorder.tooMany')}</div>
      )}

      {(validation.issues.length > 0 || conflicts.length > 0 || failed) && (
        <div className="shortcut-recorder-problems" role="status">
          <CircleAlert size={16} aria-hidden="true" />
          <div>
            {validation.issues.map((issue, index) => (
              <p key={`${issue.code}-${index}`}>
                {issue.code === 'reserved_binding' && issue.reservation
                  ? t(`settings.shortcuts.reserved.${issue.reservation.id}`)
                  : t(`settings.shortcuts.recorder.${issueTranslationKey(issue.code)}`)}
              </p>
            ))}
            {conflicts.map((action) => (
              <p key={action}>{t('settings.shortcuts.conflict.description', { action })}</p>
            ))}
            {failed && <p>{t('settings.shortcuts.binding.saveFailed')}</p>}
          </div>
        </div>
      )}

      <span className="shortcut-recorder-action-context">
        {shortcutActionDescription(row, t)}
      </span>
    </div>
  )
}

function shortcutActionName(row: ShortcutSettingsRow, t: (key: string) => string) {
  return t(`settings.shortcuts.actions.${shortcutActionTranslationSegment(row.definition.id)}.name`)
}

function shortcutActionDescription(row: ShortcutSettingsRow, t: (key: string) => string) {
  return t(`settings.shortcuts.actions.${shortcutActionTranslationSegment(row.definition.id)}.description`)
}

function issueTranslationKey(code: string) {
  switch (code) {
    case 'too_many_bindings':
      return 'tooMany'
    case 'duplicate_binding':
      return 'duplicate'
    default:
      return 'invalidKey'
  }
}
