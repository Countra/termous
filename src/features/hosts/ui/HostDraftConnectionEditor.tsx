import { Button } from 'antd'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { validateSSHAccessProfileDraft } from '#entities/ssh-access-profile'
import { SSHProfileEditor } from '#features/manage-ssh-access'
import { SFTPProfileEditor } from '#features/manage-file-access'
import { VNCProfileEditor, validateVNCAccessProfileDraft, validateVNCTargetAuthDraft } from '#features/manage-remote-desktop'
import {
  hostCreationTemporaryHostId, projectHostCreationSSH, updateHostCreationSSH, updateHostCreationRemoteDesktop,
  type HostCreationDraft, type HostCreationValidation,
} from '../model/hostCreation.ts'
import type { HostManagementData } from '../model/types.ts'
import type { HostDraftConnectionSelection } from './HostDraftConnectionCatalog.tsx'
import styles from './HostCreation.module.scss'

interface Props {
  draft: HostCreationDraft
  selection: HostDraftConnectionSelection
  data: HostManagementData
  validation: HostCreationValidation
  submitted: boolean
  busy: boolean
  getHostIconUrl: (iconId: string) => string
  onChange: (draft: HostCreationDraft) => void
  onBack: () => void
  onManageProxies: () => void
}

export function HostDraftConnectionEditor({ draft, selection, data, validation, submitted, busy,
  getHostIconUrl, onChange, onBack, onManageProxies }: Props) {
  const { t } = useTranslation()
  const localSSH = projectHostCreationSSH(draft)
  const ssh = draft.ssh.find((item) => item.id === selection.id)
  const desktop = draft.remoteDesktops.find((item) => item.id === selection.id)
  const issueMessage = (field: string) => {
    const issue = submitted ? validation.issues.find((item) => item.kind === selection.kind && item.id === selection.id && item.field === field) : undefined
    if (!issue) return undefined
    if (issue.code === 'required') return t('hosts.access.errors.required')
    if (issue.code === 'too_long') return t('hosts.access.errors.tooLong')
    return t(`hosts.creation.errors.${issue.code}`, { defaultValue: t('hosts.creation.invalid') })
  }
  const title = selection.kind === 'file' ? ssh?.fileName : selection.kind === 'ssh' ? ssh?.draft.name : desktop?.draft.name
  return (
    <>
      <div className={styles['editor-nav']}>
        <Button type="text" size="small" icon={<ArrowLeft size={14} />} disabled={busy} onClick={onBack}>
          {t('hosts.creation.backToConnections')}
        </Button>
        <strong>{title?.trim() || t('hosts.creation.unnamed')}</strong>
      </div>
      {selection.kind === 'ssh' && ssh ? <SSHProfileEditor
        draft={ssh.draft} errors={validateSSHAccessProfileDraft(ssh.draft, ssh.id)} nameError={issueMessage('name')}
        submitted={submitted} disabled={busy} editingProfileId={ssh.id}
        credentials={data.credentials} proxies={data.proxies} jumpProfiles={[...data.sshAccessProfiles, ...localSSH]}
        jumpHosts={[...data.hostAssets, { ...draft.host, id: hostCreationTemporaryHostId,
          name: draft.host.name.trim() || t('hosts.newHost'), created_at: '', updated_at: '' }]}
        jumpGroups={data.groups} getHostIconUrl={getHostIconUrl} onManageProxies={onManageProxies}
        errorMessages={{ credential: issueMessage('credential_id'), proxy: issueMessage('proxy_id'), jump: issueMessage('jump_ssh_profile_id') }}
        onChange={(next) => onChange(updateHostCreationSSH(draft, ssh.id, { draft: next }))}
      /> : null}
      {selection.kind === 'file' && ssh ? <SFTPProfileEditor
        draft={{ name: ssh.fileName }} sshProfile={localSSH.find((item) => item.id === ssh.id)}
        error={issueMessage('name')} disabled={busy}
        onChange={(next) => onChange(updateHostCreationSSH(draft, ssh.id, { fileName: next.name }))}
      /> : null}
      {selection.kind === 'remote_desktop' && desktop ? <VNCProfileEditor
        draft={desktop.draft} errors={validateVNCAccessProfileDraft(desktop.draft, new Set(localSSH.map((item) => item.id)))}
        submitted={submitted} disabled={busy} sshProfiles={localSSH} hasSavedTargetAuth={false}
        targetAuthDraft={desktop.targetAuthDraft} targetAuthError={submitted ? validateVNCTargetAuthDraft(desktop.targetAuthDraft) : undefined}
        onChange={(next) => onChange(updateHostCreationRemoteDesktop(draft, desktop.id, { draft: next }))}
        onTargetAuthChange={(next) => onChange(updateHostCreationRemoteDesktop(draft, desktop.id, { targetAuthDraft: next }))}
      /> : null}
    </>
  )
}
