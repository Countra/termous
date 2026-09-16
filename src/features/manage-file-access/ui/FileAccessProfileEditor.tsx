import { Select } from 'antd'
import { useTranslation } from 'react-i18next'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import {
  getFileAccessProfileEditor,
  listFileAccessProfileEditors,
} from '../model/engineEditorRegistry.ts'
import type {
  FileAccessProfileEditorDraft,
  FileAccessProfileEditorErrors,
} from '../model/types.ts'
import styles from './FileAccessProfileEditor.module.scss'

interface FileAccessProfileEditorProps {
  mode: 'create' | 'edit'
  draft: FileAccessProfileEditorDraft
  sshProfiles: SSHAccessProfile[]
  errors?: FileAccessProfileEditorErrors
  disabled: boolean
  onChange: (draft: FileAccessProfileEditorDraft) => void
}

export function FileAccessProfileEditor({
  mode,
  draft,
  sshProfiles,
  errors,
  disabled,
  onChange,
}: FileAccessProfileEditorProps) {
  const { t } = useTranslation()
  const definition = getFileAccessProfileEditor(draft.engine)
  if (!definition) return null
  const Editor = definition.Editor

  return (
    <div className={styles.root}>
      <label className={styles.field}>
        <span>{t('hosts.access.file.type')}</span>
        <Select
          value={draft.engine}
          aria-label={t('hosts.access.file.type')}
          disabled={disabled || mode === 'edit'}
          options={listFileAccessProfileEditors().map((item) => ({
            value: item.engine,
            label: item.label,
          }))}
          onChange={(engine) => {
            const nextDefinition = getFileAccessProfileEditor(engine)
            const next = nextDefinition?.createDraft(draft.host_id, sshProfiles)
            if (next) onChange({ ...next, name: draft.name })
          }}
        />
      </label>
      <Editor
        draft={draft}
        sshProfiles={sshProfiles}
        errors={errors}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  )
}
