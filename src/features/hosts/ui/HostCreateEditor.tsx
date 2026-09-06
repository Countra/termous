import { Save } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HostProvisionInput } from '#entities/host-asset'
import { ConfirmDialog } from '#shared/ui'
import {
  addHostCreationSSH, addHostCreationRemoteDesktop, createHostCreationDraft, isHostCreationDirty,
  normalizeHostProvisionInput, removeHostCreationConnection, setHostCreationDefault, validateHostCreationDraft,
  type HostCreationDraft,
} from '../model/hostCreation.ts'
import type { HostManagementData } from '../model/types.ts'
import { HostAssetForm } from './HostAssetForm.tsx'
import { HostDraftConnectionCatalog, type HostDraftConnectionSelection } from './HostDraftConnectionCatalog.tsx'
import { HostDraftConnectionEditor } from './HostDraftConnectionEditor.tsx'
import { HostEditorShell, type HostEditorSection } from './HostEditorShell.tsx'

interface HostCreateEditorProps {
  data: HostManagementData
  busy: boolean
  getHostIconUrl: (iconId: string) => string
  onBack: () => void
  onCreate: (draft: HostProvisionInput, section: HostEditorSection) => Promise<void>
  onDirtyChange: (dirty: boolean) => void
  onProtectedIconIdChange: (iconId: string) => void
  onCreateGroup: (name: string) => Promise<{ id: string; name: string }>
  onManageIcons: () => void
  onManageProxies: () => void
}

export function HostCreateEditor({ data, busy, getHostIconUrl, onBack, onCreate, onDirtyChange,
  onProtectedIconIdChange, onCreateGroup, onManageIcons, onManageProxies }: HostCreateEditorProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(createHostCreationDraft)
  const [section, setSection] = useState<HostEditorSection>('asset')
  const [selection, setSelection] = useState<HostDraftConnectionSelection | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [connectionSetupOpen, setConnectionSetupOpen] = useState(false)
  const [error, setError] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef('')
  const submittingRef = useRef(false)
  const connectionSetupChoiceMadeRef = useRef(false)
  const validation = useMemo(() => validateHostCreationDraft(draft, {
    sshProfiles: data.sshAccessProfiles, credentials: data.credentials, proxies: data.proxies,
  }), [draft, data.sshAccessProfiles, data.credentials, data.proxies])
  const dirty = isHostCreationDirty(draft)

  useEffect(() => {
    if (focusRequest === 0) return
    const container = contentRef.current
    if (returnFocusRef.current) {
      const row = Array.from(container?.querySelectorAll<HTMLButtonElement>('[data-draft-connection]') ?? [])
        .find((item) => item.dataset.draftConnection === returnFocusRef.current)
      returnFocusRef.current = ''
      ;(row ?? container)?.focus()
      return
    }
    const invalid = container?.querySelector<HTMLElement>('[aria-invalid="true"], input.ant-input-status-error, .ant-select-status-error input')
    const target = invalid ?? container
    target?.focus()
    invalid?.scrollIntoView({ block: 'nearest' })
  }, [focusRequest])

  const changeDraft = (next: HostCreationDraft) => {
    if (busy || submittingRef.current) return
    setDraft(next)
    setError('')
    onDirtyChange(isHostCreationDirty(next))
    onProtectedIconIdChange(next.host.icon_id)
  }
  const discard = () => {
    changeDraft(createHostCreationDraft())
    setSelection(null)
    connectionSetupChoiceMadeRef.current = false
    setConnectionSetupOpen(false)
    setSubmitted(false)
    setDiscardOpen(false)
  }
  const addConnection = (kind: 'ssh' | 'remote_desktop') => {
    const added = kind === 'ssh' ? addHostCreationSSH(draft) : addHostCreationRemoteDesktop(draft)
    changeDraft(added.draft)
    setSelection({ kind, id: added.id })
  }
  const removeConnection = (kind: 'ssh' | 'remote_desktop', id: string) => {
    const result = removeHostCreationConnection(draft, kind, id)
    if (result.blockedBy?.length) {
      setError(t('hosts.creation.deleteBlocked'))
      return
    }
    changeDraft(result.draft)
  }
  const save = async () => {
    if (busy || submittingRef.current) return
    setSubmitted(true)
    const issue = validation.firstIssue
    if (issue) {
      setSection(issue.kind === 'asset' ? 'asset' : 'connections')
      if (issue.kind !== 'asset' && issue.id) setSelection({ kind: issue.kind, id: issue.id })
      setError(t('hosts.creation.fixIncomplete'))
      setFocusRequest((current) => current + 1)
      return
    }
    if (draft.ssh.length + draft.remoteDesktops.length === 0 && !connectionSetupChoiceMadeRef.current) {
      setError('')
      setConnectionSetupOpen(true)
      return
    }
    submittingRef.current = true
    setError('')
    try {
      await onCreate(normalizeHostProvisionInput(draft), section)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error'))
    } finally {
      submittingRef.current = false
    }
  }
  const nameIssue = submitted ? validation.issues.find((issue) => issue.kind === 'asset' && issue.field === 'name') : undefined
  return (
    <>
      <HostEditorShell mode="create" title={draft.host.name.trim() || t('hosts.newHost')} iconId={draft.host.icon_id}
        getHostIconUrl={getHostIconUrl} activeSection={section} dirty={dirty} busy={busy}
        contentRef={contentRef} error={error} onBack={onBack} onSectionChange={setSection}
        actions={{ saveLabel: t('app.save'), saveIcon: <Save size={14} />, saveDisabled: !dirty,
          onDiscard: () => setDiscardOpen(true), onSave: () => void save() }}>
        {section === 'asset' ? <HostAssetForm key={draft.clientRequestId} data={data} draft={draft.host} disabled={busy} autoFocusName
          nameError={nameIssue ? t(nameIssue.code === 'required' ? 'hosts.access.errors.required' : 'hosts.access.errors.tooLong') : undefined}
          getHostIconUrl={getHostIconUrl} onChange={(host) => changeDraft({ ...draft, host })}
          onCreateGroup={onCreateGroup} onManageIcons={onManageIcons}
        /> : selection ? <HostDraftConnectionEditor key={`${selection.kind}:${selection.id}`} draft={draft} selection={selection}
          data={data} validation={validation} submitted={submitted} busy={busy} getHostIconUrl={getHostIconUrl}
          onChange={changeDraft} onBack={() => {
            returnFocusRef.current = `${selection.kind}:${selection.id}`
            setSelection(null)
            setFocusRequest((current) => current + 1)
          }} onManageProxies={onManageProxies}
        /> : <HostDraftConnectionCatalog draft={draft} validation={validation} busy={busy}
          onAdd={addConnection} onEdit={setSelection} onDelete={removeConnection}
          onSetDefault={(kind, id) => changeDraft(setHostCreationDefault(draft, kind, id))} />}
      </HostEditorShell>
      <ConfirmDialog open={connectionSetupOpen}
        title={t('hosts.creation.noConnectionsTitle')} description={t('hosts.creation.noConnectionsDescription')}
        secondaryLabel={t('hosts.creation.saveHostOnly')} confirmLabel={t('hosts.connectionSetup.go')}
        showCancelButton={false} showCloseButton
        onSecondary={() => {
          if (busy || submittingRef.current) return
          connectionSetupChoiceMadeRef.current = true
          setConnectionSetupOpen(false)
          void save()
        }}
        onConfirm={() => {
          connectionSetupChoiceMadeRef.current = true
          setConnectionSetupOpen(false)
          setSubmitted(false)
          setSelection(null)
          setSection('connections')
        }}
        onCancel={() => setConnectionSetupOpen(false)}
        onAfterClose={() => contentRef.current?.focus()} />
      <ConfirmDialog open={discardOpen} title={t('hosts.unsavedTitle')} description={t('hosts.creation.discardDescription')}
        confirmLabel={t('hosts.discard')} danger onConfirm={discard} onCancel={() => setDiscardOpen(false)}
        onAfterClose={() => contentRef.current?.focus()} />
    </>
  )
}
