import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ManagementWorkspace, type ManagementWorkspaceView } from '../../components/management/ManagementWorkspace'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import type { AppData, CredentialInput, CredentialView } from '../../types/domain'
import { CredentialCatalog } from './CredentialCatalog'
import { CredentialEditor } from './CredentialEditor'
import {
  createBlankCredentialInput,
  credentialInputsEqual,
  credentialToInput,
  normalizeCredentialInput,
  validateCredentialInput,
} from './credentialManagementUtils'
import './vault.css'

interface VaultPageProps {
  data: AppData
  actionBusy: boolean
  onSave: (id: string | null, input: CredentialInput) => Promise<CredentialView | undefined>
  onDelete: (id: string) => Promise<boolean | undefined>
  onGenerateKey: () => Promise<CredentialView | undefined>
}

type CredentialIntent =
  | { type: 'select'; credentialId: string }
  | { type: 'create' }
  | { type: 'back' }
  | { type: 'generate' }

export function VaultPage({ data, actionBusy, onSave, onDelete, onGenerateKey }: VaultPageProps) {
  const { t } = useTranslation()
  const initialInput = createBlankCredentialInput()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CredentialInput>(initialInput)
  const [baseline, setBaseline] = useState<CredentialInput>(initialInput)
  const [activeView, setActiveView] = useState<ManagementWorkspaceView>('catalog')
  const [pendingIntent, setPendingIntent] = useState<CredentialIntent | null>(null)
  const dirty = useMemo(() => !credentialInputsEqual(draft, baseline), [baseline, draft])
  const editingCredential = useMemo(
    () => data.credentials.find((credential) => credential.id === editingId),
    [data.credentials, editingId],
  )
  const requireSecret = !editingCredential || draft.type !== editingCredential.type
  const errors = useMemo(() => validateCredentialInput(draft, requireSecret, {
    name: t('vault.validation.nameRequired'),
    secret: t('vault.validation.secretRequired'),
  }), [draft, requireSecret, t])

  const loadCredential = useCallback((credential: CredentialView) => {
    const input = credentialToInput(credential)
    setEditingId(credential.id)
    setDraft(input)
    setBaseline(input)
    setActiveView('editor')
  }, [])

  const loadCredentialById = useCallback((credentialId: string) => {
    const credential = data.credentials.find((item) => item.id === credentialId)
    if (credential) {
      loadCredential(credential)
    }
  }, [data.credentials, loadCredential])

  const startCreate = useCallback(() => {
    const input = createBlankCredentialInput()
    setEditingId(null)
    setDraft(input)
    setBaseline(input)
    setActiveView('editor')
  }, [])

  const generateKey = useCallback(async () => {
    const generated = await onGenerateKey()
    if (generated) {
      loadCredential(generated)
    }
  }, [loadCredential, onGenerateKey])

  const applyIntent = useCallback(async (intent: CredentialIntent) => {
    if (intent.type === 'select') {
      loadCredentialById(intent.credentialId)
      return
    }
    if (intent.type === 'create') {
      startCreate()
      return
    }
    if (intent.type === 'generate') {
      await generateKey()
      return
    }
    setDraft(baseline)
    setActiveView('catalog')
  }, [baseline, generateKey, loadCredentialById, startCreate])

  const requestIntent = useCallback((intent: CredentialIntent) => {
    if (intent.type === 'select' && intent.credentialId === editingId) {
      setActiveView('editor')
      return
    }
    if (dirty) {
      setPendingIntent(intent)
      return
    }
    void applyIntent(intent)
  }, [applyIntent, dirty, editingId])

  useEffect(() => {
    if (!editingCredential || dirty) {
      return
    }
    const next = credentialToInput(editingCredential)
    if (!credentialInputsEqual(next, baseline)) {
      setDraft(next)
      setBaseline(next)
    }
  }, [baseline, dirty, editingCredential])

  const save = async () => {
    const saved = await onSave(editingId, normalizeCredentialInput(draft))
    if (saved) {
      loadCredential(saved)
    }
  }

  const removeCurrentCredential = async () => {
    if (!editingId || editingCredential?.bound_host_count) {
      return
    }
    const currentIndex = data.credentials.findIndex((credential) => credential.id === editingId)
    const removed = await onDelete(editingId)
    if (!removed) {
      return
    }
    const remaining = data.credentials.filter((credential) => credential.id !== editingId)
    const next = remaining[Math.min(currentIndex, remaining.length - 1)]
    if (next) {
      loadCredential(next)
    } else {
      const empty = createBlankCredentialInput()
      setEditingId(null)
      setDraft(empty)
      setBaseline(empty)
      setActiveView('catalog')
    }
  }

  return (
    <>
      <ManagementWorkspace
        className="vault-management-workspace"
        activeView={activeView}
        catalogLabel={t('vault.list')}
        editorLabel={t('vault.editor')}
        catalog={(
          <CredentialCatalog
            credentials={data.credentials}
            selectedCredentialId={editingId}
            actionBusy={actionBusy}
            onSelect={(credentialId) => requestIntent({ type: 'select', credentialId })}
            onCreate={() => requestIntent({ type: 'create' })}
            onGenerateKey={() => requestIntent({ type: 'generate' })}
          />
        )}
        editor={(
          <CredentialEditor
            credentials={data.credentials}
            editingCredential={editingCredential}
            draft={draft}
            dirty={dirty}
            requireSecret={requireSecret}
            errors={errors}
            actionBusy={actionBusy}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            onBack={() => requestIntent({ type: 'back' })}
            onSave={() => void save()}
            onDelete={() => void removeCurrentCredential()}
            onDiscard={() => setDraft(baseline)}
          />
        )}
      />
      <ConfirmDialog
        open={Boolean(pendingIntent)}
        title={t('vault.unsavedTitle')}
        description={t('vault.unsavedDescription')}
        confirmLabel={t('vault.discardAndContinue')}
        cancelLabel={t('app.cancel')}
        danger
        onCancel={() => setPendingIntent(null)}
        onConfirm={() => {
          const intent = pendingIntent
          setPendingIntent(null)
          if (intent) {
            void applyIntent(intent)
          }
        }}
      />
    </>
  )
}
