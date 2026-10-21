import { useTranslation } from 'react-i18next'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import { CustomSelect } from '#shared/ui'
import {
  getFileAccessProfileEditor,
  listFileAccessProfileEditors,
} from '../model/engineEditorRegistry.ts'
import type {
  FileAccessProfileEditorDraft,
  FileAccessProfileEditorErrors,
} from '../model/types.ts'

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

  const protocolControl = (
    <CustomSelect
      label={t('hosts.access.file.type')}
      value={draft.engine}
      disabled={disabled || mode === 'edit'}
      options={listFileAccessProfileEditors().map((item) => ({
        value: item.engine,
        label: item.label,
      }))}
      onChange={(engine) => {
        const nextDefinition = getFileAccessProfileEditor(engine)
        const next = nextDefinition?.createDraft(draft.host_id, sshProfiles)
        const defaultName = definition.createDraft(draft.host_id, sshProfiles).name
        if (next) onChange({ ...next, name: draft.name === defaultName ? next.name : draft.name })
      }}
    />
  )

  return (
    <Editor
      draft={draft}
      sshProfiles={sshProfiles}
      errors={errors}
      disabled={disabled}
      protocolControl={protocolControl}
      onChange={onChange}
    />
  )
}
