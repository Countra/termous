import { Button, Form, Input, Modal, Select, Tooltip } from 'antd'
import { Bookmark, Check, FolderTree } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  FileBookmark,
  FileBookmarkGroup,
  FileBookmarkInput,
} from '../../types/domain'
import { sortBookmarkGroups, suggestBookmarkName } from '../files/fileBookmarksModel'

interface WorkbenchBookmarkEditorModalProps {
  open: boolean
  currentPath: string
  bookmark: FileBookmark | null
  groups: readonly FileBookmarkGroup[]
  saving: boolean
  error: string
  onCancel: () => void
  onSubmit: (input: FileBookmarkInput) => Promise<void> | void
}

interface BookmarkCreateFormValue {
  name: string
  group_id: string
}

export function WorkbenchBookmarkEditorModal({
  open,
  currentPath,
  bookmark,
  groups,
  saving,
  error,
  onCancel,
  onSubmit,
}: WorkbenchBookmarkEditorModalProps) {
  const { t } = useTranslation()
  const [form] = Form.useForm<BookmarkCreateFormValue>()
  const groupOptions = useMemo(
    () => [
      { value: '', label: t('files.bookmarksUngrouped') },
      ...[...groups]
        .sort(sortBookmarkGroups)
        .map((group) => ({ value: group.id, label: group.name })),
    ],
    [groups, t],
  )

  useEffect(() => {
    if (!open) {
      return
    }
    const knownGroupIds = new Set(groups.map((group) => group.id))
    form.setFieldsValue({
      name: bookmark?.name ?? suggestBookmarkName(currentPath),
      group_id: bookmark?.group_id && knownGroupIds.has(bookmark.group_id)
        ? bookmark.group_id
        : '',
    })
    window.requestAnimationFrame(() => {
      form.getFieldInstance('name')?.focus?.()
    })
  }, [bookmark, currentPath, form, groups, open])

  const editing = Boolean(bookmark)

  return (
    <Modal
      open={open}
      width={420}
      centered
      destroyOnHidden
      keyboard={!saving}
      maskClosable={!saving}
      closable={!saving}
      zIndex={3700}
      rootClassName="termous-modal-root workbench-bookmark-editor-root"
      className="workbench-bookmark-editor-modal"
      title={(
        <span className="workbench-bookmark-editor-title">
          <Bookmark size={16} aria-hidden="true" />
          <span>{t(editing ? 'files.editBookmark' : 'files.addBookmark')}</span>
        </span>
      )}
      footer={(
        <div className="workbench-bookmark-editor-actions">
          <Button disabled={saving} onClick={onCancel}>
            {t('app.cancel')}
          </Button>
          <Button
            type="primary"
            icon={<Check size={14} aria-hidden="true" />}
            loading={saving}
            onClick={() => form.submit()}
          >
            {t(editing ? 'app.save' : 'app.create')}
          </Button>
        </div>
      )}
      onCancel={onCancel}
      afterOpenChange={(nextOpen) => {
        if (!nextOpen) {
          form.resetFields()
        }
      }}
    >
      <Form<BookmarkCreateFormValue>
        form={form}
        layout="vertical"
        requiredMark={false}
        className="workbench-bookmark-editor-form"
        onFinish={(values) => void onSubmit({
          name: values.name.trim(),
          path: currentPath,
          group_id: values.group_id,
        })}
      >
        <div className="workbench-bookmark-editor-path">
          <span className="workbench-bookmark-editor-path-icon" aria-hidden="true">
            <FolderTree size={15} />
          </span>
          <span>
            <small>{t('files.bookmarkPath')}</small>
            <Tooltip
              title={currentPath}
              placement="topLeft"
              mouseEnterDelay={0.45}
              zIndex={3800}
              classNames={{ root: 'termous-tooltip workbench-bookmark-editor-tooltip' }}
            >
              <strong>{currentPath}</strong>
            </Tooltip>
          </span>
        </div>

        <Form.Item
          name="name"
          label={t('files.bookmarkName')}
          validateTrigger="onSubmit"
          rules={[
            {
              required: true,
              whitespace: true,
              message: t('files.bookmarkNameRequired'),
            },
          ]}
        >
          <Input
            autoComplete="off"
            placeholder={t('files.bookmarkNamePlaceholder')}
            disabled={saving}
          />
        </Form.Item>

        <Form.Item
          name="group_id"
          label={t('files.bookmarkGroup')}
          initialValue=""
        >
          <Select
            className="termous-select workbench-bookmark-editor-select"
            classNames={{
              popup: {
                root: 'workbench-bookmark-editor-select-popup',
              },
            }}
            options={groupOptions}
            disabled={saving}
          />
        </Form.Item>

        {error ? (
          <div className="workbench-bookmark-editor-error" role="alert">
            {error}
          </div>
        ) : null}
      </Form>
    </Modal>
  )
}
