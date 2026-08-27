import { Button, Popconfirm } from 'antd'
import { Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  Host,
  HostGroup,
  HostInput,
  HostValidationErrors,
} from '#entities/host'
import { validateSSHAccessProfileDraft } from '#entities/ssh-access-profile'
import { SSHProfileEditor } from '#features/manage-ssh-access'
import type { HostManagementData } from '../model/types.ts'
import {
  mergeHostAssetDraft,
  mergeInitialSSHProfileDraft,
  projectHostAssetDraft,
  projectInitialSSHProfileDraft,
  selectInitialJumpProfiles,
} from '../model/hostEditorDraft.ts'
import { HostAssetForm } from './HostAssetForm.tsx'
import {
  HostEditorShell,
  type HostEditorSection,
} from './HostEditorShell.tsx'
import styles from './HostManagement.module.scss'

interface HostEditorProps {
  data: HostManagementData
  editingHost?: Host
  draft: HostInput
  dirty: boolean
  errors: HostValidationErrors
  actionBusy: boolean
  getHostIconUrl: (iconId: string) => string
  onChange: (patch: Partial<HostInput>) => void
  onBack: () => void
  onSave: () => void
  onDelete: () => void
  onDiscard: () => void
  onCreateGroup: (name: string) => Promise<HostGroup>
  onManageProxies: () => void
  onManageIcons: () => void
}

export function HostEditor({
  data,
  editingHost,
  draft,
  dirty,
  errors,
  actionBusy,
  getHostIconUrl,
  onChange,
  onBack,
  onSave,
  onDelete,
  onDiscard,
  onCreateGroup,
  onManageProxies,
  onManageIcons,
}: HostEditorProps) {
  const { t } = useTranslation()
  const [activeSection, setActiveSection] = useState<HostEditorSection>('asset')
  const [submitted, setSubmitted] = useState(false)
  const [focusRequest, setFocusRequest] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)
  const assetDraft = useMemo(() => projectHostAssetDraft(draft), [draft])
  const jumpProfiles = useMemo(
    () => selectInitialJumpProfiles(data.sshAccessProfiles)
      .filter((profile) => profile.host_id !== editingHost?.id),
    [data.sshAccessProfiles, editingHost?.id],
  )
  const sshDraft = useMemo(
    () => projectInitialSSHProfileDraft(draft, jumpProfiles),
    [draft, jumpProfiles],
  )
  const sshErrors = useMemo(
    () => validateSSHAccessProfileDraft(sshDraft),
    [sshDraft],
  )
  const hasConnectionErrors = Object.values(errors).some(Boolean)
    || Boolean(
      sshErrors.address
      || sshErrors.port
      || sshErrors.username
      || sshErrors.credential_id
      || sshErrors.jump_ssh_profile_id,
    )
  const displayName = draft.name.trim()
    || draft.address.trim()
    || editingHost?.name.trim()
    || t('hosts.newHost')

  const submit = () => {
    setSubmitted(true)
    if (hasConnectionErrors) {
      setActiveSection('connections')
      setFocusRequest((current) => current + 1)
      return
    }
    onSave()
  }

  const discard = () => {
    setSubmitted(false)
    onDiscard()
  }

  useEffect(() => {
    if (focusRequest > 0) {
      contentRef.current?.focus()
    }
  }, [focusRequest])

  return (
    <HostEditorShell
      mode={editingHost ? 'edit' : 'create'}
      title={displayName}
      iconId={draft.icon_id}
      getHostIconUrl={getHostIconUrl}
      activeSection={activeSection}
      dirty={dirty}
      busy={actionBusy}
      contentRef={contentRef}
      onBack={onBack}
      onSectionChange={setActiveSection}
      actions={{
        leading: editingHost ? (
          <Popconfirm
            title={t('app.confirmDelete')}
            description={t('hosts.deleteHint')}
            okText={t('app.delete')}
            cancelText={t('app.cancel')}
            disabled={actionBusy}
            rootClassName={`host-popconfirm ${styles.popconfirm}`}
            onConfirm={onDelete}
          >
            <Button danger icon={<Trash2 size={14} />} disabled={actionBusy}>
              {t('app.delete')}
            </Button>
          </Popconfirm>
        ) : undefined,
        saveLabel: t(editingHost ? 'app.save' : 'app.create'),
        saveIcon: editingHost ? <Save size={14} /> : <Plus size={14} />,
        saveDisabled: !dirty,
        onDiscard: discard,
        onSave: submit,
      }}
    >
      {activeSection === 'asset' ? (
        <HostAssetForm
          data={data}
          draft={assetDraft}
          nameHint={t('hosts.nameHint')}
          autoFocusName
          disabled={actionBusy}
          getHostIconUrl={getHostIconUrl}
          onChange={(asset) => onChange(mergeHostAssetDraft(draft, asset))}
          onCreateGroup={onCreateGroup}
          onManageIcons={onManageIcons}
        />
      ) : (
        <SSHProfileEditor
          draft={sshDraft}
          errors={sshErrors}
          submitted={submitted}
          disabled={actionBusy}
          credentials={data.credentials}
          proxies={data.proxies}
          jumpProfiles={jumpProfiles}
          jumpHosts={data.hostAssets}
          jumpGroups={data.groups}
          getHostIconUrl={getHostIconUrl}
          showProfileName={false}
          autoFocus={false}
          errorMessages={submitted ? {
            address: errors.address,
            port: errors.port,
            username: errors.username,
            credential: errors.credentialId,
            proxy: errors.proxyId,
          } : undefined}
          onManageProxies={onManageProxies}
          onChange={(profile) => onChange(
            mergeInitialSSHProfileDraft(draft, profile, jumpProfiles),
          )}
        />
      )}
    </HostEditorShell>
  )
}
