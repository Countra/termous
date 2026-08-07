import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createBlankCredentialInput,
  credentialInputsEqual,
  credentialToInput,
  normalizeCredentialInput,
  type CredentialInput,
  type CredentialType,
  type CredentialView,
  type SSHKeyGenerateRequest,
  type SSHKeyInspectResult,
  type SSHKeyPair,
} from '#entities/credential'
import { getTermousBridge } from '#shared/bridge'
import { TermousApiError } from '#shared/api'
import { ConfirmDialog } from '#shared/ui'
import { ManagementWorkspace, type ManagementWorkspaceView } from '#shared/ui'
import {
  type CredentialGatewayFactory,
} from '../api/credentialGateway.ts'
import { validateCredentialInput } from '../model/credentialCatalog.ts'
import { privateKeyNameFromFile, sshKeyErrorMessage } from '../model/sshKeyUi.ts'
import { CredentialCatalog } from './CredentialCatalog'
import { CredentialEditor } from './CredentialEditor'
import { PrivateKeyPassphraseModal, type PrivateKeyUnlockInput } from './PrivateKeyPassphraseModal'
import { SSHKeyGenerationModal } from './SSHKeyGenerationModal'

export interface VaultWorkspaceProps {
  className?: string
  credentials: CredentialView[]
  actionBusy: boolean
  onSave: (id: string | null, input: CredentialInput) => Promise<CredentialView | undefined>
  onDelete: (id: string) => Promise<boolean | undefined>
  onDirtyChange: (dirty: boolean) => void
  createGateway: CredentialGatewayFactory
}

type CredentialIntent =
  | { type: 'select'; credentialId: string }
  | { type: 'create' }
  | { type: 'back' }
  | { type: 'generate' }
  | { type: 'change_type'; credentialType: CredentialType }

interface PendingPrivateKeyImport {
  fileName: string
  privateKey: string
}

export function VaultWorkspace({
  className,
  credentials,
  actionBusy,
  onSave,
  onDelete,
  onDirtyChange,
  createGateway,
}: VaultWorkspaceProps) {
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
  const gatewayRef = useRef<ReturnType<CredentialGatewayFactory> | null>(null)
  const gatewayFactoryRef = useRef(createGateway)
  const importControllerRef = useRef<AbortController | null>(null)
  const importRevisionRef = useRef(0)
  const dirty = useMemo(() => !credentialInputsEqual(draft, baseline), [baseline, draft])
  const editingCredential = useMemo(
    () => credentials.find((credential) => credential.id === editingId),
    [credentials, editingId],
  )
  const passphraseCredentials = useMemo(
    () => credentials.filter((credential) => credential.type === 'private_key_passphrase'),
    [credentials],
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
    const credential = credentials.find((item) => item.id === credentialId)
    if (credential) {
      loadCredential(credential)
    }
  }, [credentials, loadCredential])

  const startCreate = useCallback(() => {
    const input = createBlankCredentialInput()
    setEditingId(null)
    setDraft(input)
    setBaseline(input)
    setActiveView('editor')
  }, [])

  const getGateway = useCallback(() => {
    if (gatewayFactoryRef.current !== createGateway) {
      gatewayFactoryRef.current = createGateway
      gatewayRef.current = null
    }
    if (!gatewayRef.current) {
      gatewayRef.current = createGateway()
    }
    return gatewayRef.current
  }, [createGateway])

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

  const applyImportedKey = useCallback((source: PendingPrivateKeyImport, result: SSHKeyInspectResult, unlock?: PrivateKeyUnlockInput) => {
    const importedName = privateKeyNameFromFile(source.fileName, t('vault.sshKey.defaultName'))
    setDraft((current) => {
      const credentialName = current.name.trim() || importedName
      const metadata = { ...current.metadata }
      delete metadata.passphrase_credential_id
      if (result.encrypted && unlock?.source === 'existing') {
        metadata.passphrase_credential_id = unlock.credentialId
      }
      return {
        ...current,
        name: credentialName,
        type: 'private_key',
        secret: source.privateKey,
        metadata,
        ssh_key_info: result.info,
        pending_passphrase: result.encrypted && unlock?.source === 'new'
          ? {
              name: t('vault.sshKey.generatedPassphraseName', { name: credentialName }),
              secret: unlock.passphrase,
            }
          : undefined,
      }
    })
    setImportError('')
    setActiveView('editor')
    clearPendingImport()
  }, [clearPendingImport, t])

  const inspectImportedKey = useCallback(async (source: PendingPrivateKeyImport, unlock?: PrivateKeyUnlockInput) => {
    const revision = importRevisionRef.current + 1
    importRevisionRef.current = revision
    importControllerRef.current?.abort()
    const controller = new AbortController()
    importControllerRef.current = controller
    setImportBusy(true)
    setImportError('')
    try {
      const gateway = await getGateway()
      const result = await gateway.inspectSSHKey({
        private_key_openssh: source.privateKey,
        passphrase: unlock?.source === 'new' ? unlock.passphrase : undefined,
        passphrase_credential_id: unlock?.source === 'existing' ? unlock.credentialId : undefined,
      }, controller.signal)
      if (revision === importRevisionRef.current) {
        applyImportedKey(source, result, unlock)
      }
    } catch (error) {
      if (revision !== importRevisionRef.current || controller.signal.aborted) {
        return
      }
      if (!unlock && error instanceof TermousApiError && error.code === 'passphrase_required') {
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
  }, [applyImportedKey, getGateway, t])

  const beginImport = useCallback(async () => {
    setImportError('')
    const bridge = getTermousBridge()?.sshKeys
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
    if (intent.type === 'change_type') {
      setDraft({
        ...baseline,
        type: intent.credentialType,
        secret: '',
        metadata: {},
        ssh_key_info: undefined,
        pending_passphrase: undefined,
      })
      return
    }
    setDraft(baseline)
    setActiveView('catalog')
  }, [baseline, loadCredentialById, startCreate])

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

  useLayoutEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  useEffect(() => () => {
    importRevisionRef.current += 1
    importControllerRef.current?.abort()
    importControllerRef.current = null
    gatewayRef.current = null
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
    const currentIndex = credentials.findIndex((credential) => credential.id === editingId)
    const removed = await onDelete(editingId)
    if (!removed) {
      return
    }
    const remaining = credentials.filter((credential) => credential.id !== editingId)
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
        className={className}
        activeView={activeView}
        catalogLabel={t('vault.list')}
        editorLabel={t('vault.editor')}
        catalog={(
          <CredentialCatalog
            credentials={credentials}
            selectedCredentialId={editingId}
            actionBusy={actionBusy}
            onSelect={(credentialId) => requestIntent({ type: 'select', credentialId })}
            onCreate={() => requestIntent({ type: 'create' })}
            onGenerateKey={() => requestIntent({ type: 'generate' })}
          />
        )}
        editor={(
          <CredentialEditor
            credentials={credentials}
            editingCredential={editingCredential}
            draft={draft}
            dirty={dirty}
            requireSecret={requireSecret}
            errors={errors}
            actionBusy={actionBusy}
            importBusy={importBusy}
            importError={pendingImport ? '' : importError}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            onTypeChange={(credentialType) => requestIntent({ type: 'change_type', credentialType })}
            onBack={() => requestIntent({ type: 'back' })}
            onSave={() => void save()}
            onDelete={() => void removeCurrentCredential()}
            onDiscard={() => setDraft(baseline)}
            onImportKey={() => void beginImport()}
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
          const gateway = await getGateway()
          return gateway.generateSSHKey(input, signal)
        }}
        onApply={applyPrivateKeyDraft}
      />
      <PrivateKeyPassphraseModal
        open={Boolean(pendingImport)}
        fileName={pendingImport?.fileName ?? ''}
        busy={importBusy}
        error={importError}
        credentials={passphraseCredentials}
        defaultCredentialId={draft.metadata.passphrase_credential_id}
        onCancel={() => { clearPendingImport(); setImportError('') }}
        onInputChange={() => setImportError('')}
        onConfirm={(unlock) => {
          if (pendingImport) {
            void inspectImportedKey(pendingImport, unlock)
          }
        }}
      />
    </>
  )
}
