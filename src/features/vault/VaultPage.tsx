import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createApiFromRuntime, TermousApiError } from '../../api/client'
import { ManagementWorkspace, type ManagementWorkspaceView } from '../../components/management/ManagementWorkspace'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import type { AppData, CredentialInput, CredentialView, SSHKeyGenerateRequest, SSHKeyInspectResult, SSHKeyPair } from '../../types/domain'
import { CredentialCatalog } from './CredentialCatalog'
import { CredentialEditor } from './CredentialEditor'
import { PrivateKeyPassphraseModal } from './PrivateKeyPassphraseModal'
import { SSHKeyGenerationModal } from './SSHKeyGenerationModal'
import {
  createBlankCredentialInput,
  credentialInputsEqual,
  credentialToInput,
  normalizeCredentialInput,
  validateCredentialInput,
} from './credentialManagementUtils'
import { buildPrivateKeyDraft, privateKeyNameFromFile, sshKeyErrorMessage } from './sshKeyUi'
import './vault.css'

interface VaultPageProps {
  data: AppData
  actionBusy: boolean
  onSave: (id: string | null, input: CredentialInput) => Promise<CredentialView | undefined>
  onDelete: (id: string) => Promise<boolean | undefined>
}

type CredentialIntent =
  | { type: 'select'; credentialId: string }
  | { type: 'create' }
  | { type: 'back' }
  | { type: 'generate' }
  | { type: 'import' }

interface PendingPrivateKeyImport {
  fileName: string
  privateKey: string
}

export function VaultPage({ data, actionBusy, onSave, onDelete }: VaultPageProps) {
  const { t } = useTranslation()
  const initialInput = createBlankCredentialInput()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CredentialInput>(initialInput)
  const [baseline, setBaseline] = useState<CredentialInput>(initialInput)
  const [activeView, setActiveView] = useState<ManagementWorkspaceView>('catalog')
  const [pendingIntent, setPendingIntent] = useState<CredentialIntent | null>(null)
  const [generationOpen, setGenerationOpen] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState('')
  const [pendingImport, setPendingImport] = useState<PendingPrivateKeyImport | null>(null)
  const apiRef = useRef<ReturnType<typeof createApiFromRuntime> | null>(null)
  const importControllerRef = useRef<AbortController | null>(null)
  const importRevisionRef = useRef(0)
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

  const getApi = useCallback(() => {
    if (!apiRef.current) {
      apiRef.current = createApiFromRuntime()
    }
    return apiRef.current
  }, [])

  const applyPrivateKeyDraft = useCallback((input: CredentialInput) => {
    setEditingId(null)
    setDraft(input)
    setBaseline(createBlankCredentialInput('private_key'))
    setImportError('')
    setActiveView('editor')
  }, [])

  const clearPendingImport = useCallback(() => {
    importRevisionRef.current += 1
    importControllerRef.current?.abort()
    importControllerRef.current = null
    setImportBusy(false)
    setPendingImport(null)
  }, [])

  const applyImportedKey = useCallback((source: PendingPrivateKeyImport, result: SSHKeyInspectResult, passphrase?: string) => {
    const credentialName = privateKeyNameFromFile(source.fileName, t('vault.sshKey.defaultName'))
    applyPrivateKeyDraft(buildPrivateKeyDraft(
      credentialName,
      source.privateKey,
      result.info,
      result.encrypted ? passphrase : undefined,
      t('vault.sshKey.generatedPassphraseName', { name: credentialName }),
    ))
    clearPendingImport()
  }, [applyPrivateKeyDraft, clearPendingImport, t])

  const inspectImportedKey = useCallback(async (source: PendingPrivateKeyImport, passphrase?: string) => {
    const revision = importRevisionRef.current + 1
    importRevisionRef.current = revision
    importControllerRef.current?.abort()
    const controller = new AbortController()
    importControllerRef.current = controller
    setImportBusy(true)
    setImportError('')
    try {
      const api = await getApi()
      const result = await api.inspectSSHKey({
        private_key_openssh: source.privateKey,
        passphrase,
      }, controller.signal)
      if (revision === importRevisionRef.current) {
        applyImportedKey(source, result, passphrase)
      }
    } catch (error) {
      if (revision !== importRevisionRef.current || controller.signal.aborted) {
        return
      }
      if (!passphrase && error instanceof TermousApiError && error.code === 'passphrase_required') {
        setPendingImport(source)
        setImportError('')
      } else {
        setImportError(sshKeyErrorMessage(error, t))
      }
    } finally {
      if (revision === importRevisionRef.current) {
        setImportBusy(false)
        importControllerRef.current = null
      }
    }
  }, [applyImportedKey, getApi, t])

  const beginImport = useCallback(async () => {
    setImportError('')
    const bridge = window.termous?.sshKeys
    if (!bridge) {
      setImportError(t('vault.sshKey.errors.file_integration_unavailable'))
      return
    }
    const revision = importRevisionRef.current + 1
    importRevisionRef.current = revision
    setImportBusy(true)
    try {
      const selected = await bridge.selectPrivateKey()
      if (revision !== importRevisionRef.current || selected.canceled) {
        return
      }
      if (!selected.file_name || !selected.private_key) {
        setImportError(t('vault.sshKey.errors.private_key_read_failed'))
        return
      }
      await inspectImportedKey({ fileName: selected.file_name, privateKey: selected.private_key })
    } catch (error) {
      if (revision === importRevisionRef.current) {
        setImportError(sshKeyErrorMessage(error, t))
      }
    } finally {
      if (revision === importRevisionRef.current) {
        setImportBusy(false)
      }
    }
  }, [inspectImportedKey, t])

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
      setGenerationOpen(true)
      return
    }
    if (intent.type === 'import') {
      await beginImport()
      return
    }
    setDraft(baseline)
    setActiveView('catalog')
  }, [baseline, beginImport, loadCredentialById, startCreate])

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

  useEffect(() => () => {
    importRevisionRef.current += 1
    importControllerRef.current?.abort()
    importControllerRef.current = null
    apiRef.current = null
  }, [])

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
            importBusy={importBusy}
            importError={pendingImport ? '' : importError}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            onBack={() => requestIntent({ type: 'back' })}
            onSave={() => void save()}
            onDelete={() => void removeCurrentCredential()}
            onDiscard={() => setDraft(baseline)}
            onImportKey={() => requestIntent({ type: 'import' })}
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
      <SSHKeyGenerationModal
        open={generationOpen}
        onClose={() => setGenerationOpen(false)}
        onGenerate={async (input: SSHKeyGenerateRequest, signal: AbortSignal): Promise<SSHKeyPair> => {
          const api = await getApi()
          return api.generateSSHKey(input, signal)
        }}
        onApply={applyPrivateKeyDraft}
      />
      <PrivateKeyPassphraseModal
        open={Boolean(pendingImport)}
        fileName={pendingImport?.fileName ?? ''}
        busy={importBusy}
        error={importError}
        onCancel={() => { clearPendingImport(); setImportError('') }}
        onConfirm={(passphrase) => {
          if (pendingImport) {
            void inspectImportedKey(pendingImport, passphrase)
          }
        }}
      />
    </>
  )
}
