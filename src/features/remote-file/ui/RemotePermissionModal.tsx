import { Checkbox, Input, Modal, Segmented } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteFileEntry } from '#entities/file'
import { confirmDialogStyles } from '#shared/ui'
import styles from './RemotePermissionModal.module.scss'

type PermissionEditorMode = 'visual' | 'numeric'
type PermissionRole = 'owner' | 'group' | 'others'
type PermissionAction = 'read' | 'write' | 'execute'
type PermissionBits = Record<PermissionRole, Record<PermissionAction, boolean>>

const permissionRoles: PermissionRole[] = ['owner', 'group', 'others']
const permissionActions: PermissionAction[] = ['read', 'write', 'execute']
const permissionActionValues: Record<PermissionAction, number> = {
  read: 4,
  write: 2,
  execute: 1,
}

interface RemotePermissionModalProps {
  entry: RemoteFileEntry | null
  open: boolean
  saving: boolean
  onCancel: () => void
  onSubmit: (entry: RemoteFileEntry, mode: string) => void
}

export function RemotePermissionModal({
  entry,
  open,
  saving,
  onCancel,
  onSubmit,
}: RemotePermissionModalProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<PermissionEditorMode>('visual')
  const [octal, setOctal] = useState('644')
  const valid = isPermissionOctal(octal)
  const bits = useMemo(() => octalToPermissionBits(valid ? octal : '000'), [octal, valid])

  useEffect(() => {
    if (!entry) {
      return
    }
    setMode('visual')
    setOctal(entryPermissionOctal(entry))
  }, [entry])

  const setPermissionBit = (role: PermissionRole, action: PermissionAction, checked: boolean) => {
    const next = octalToPermissionBits(valid ? octal : '000')
    next[role][action] = checked
    setOctal(permissionBitsToOctal(next))
  }

  return (
    <Modal
      title={t('files.permissionsTitle')}
      open={open}
      centered
      destroyOnHidden
      okText={t('app.update')}
      cancelText={t('app.cancel')}
      confirmLoading={saving}
      okButtonProps={{ disabled: !entry || !valid }}
      className="termous-modal permission-editor-modal"
      rootClassName={`${confirmDialogStyles['modal-root']} termous-modal-root ${styles.root}`}
      onCancel={onCancel}
      onOk={() => {
        if (entry && valid) {
          onSubmit(entry, octal)
        }
      }}
    >
      {entry ? (
        <div className="permission-editor">
          <div className="permission-target">
            <strong>{entry.name}</strong>
            <span>{entry.path}</span>
          </div>
          <Segmented
            block
            className="permission-mode-segmented"
            value={mode}
            options={[
              { label: t('files.permissionsVisualMode'), value: 'visual' },
              { label: t('files.permissionsNumericMode'), value: 'numeric' },
            ]}
            onChange={(value) => setMode(value as PermissionEditorMode)}
          />
          {mode === 'visual' ? (
            <div className="permission-grid" role="group" aria-label={t('files.permissionsVisualMode')}>
              <span />
              {permissionRoles.map((role) => (
                <strong key={role}>{t(`files.permissionRole.${role}`)}</strong>
              ))}
              {permissionActions.map((action) => (
                <div className="permission-row" key={action}>
                  <span>{t(`files.permissionAction.${action}`)}</span>
                  {permissionRoles.map((role) => (
                    <Checkbox
                      key={`${role}-${action}`}
                      checked={bits[role][action]}
                      onChange={(event) => setPermissionBit(role, action, event.target.checked)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="permission-numeric">
              <label htmlFor="permission-octal-input">{t('files.permissionsNumericLabel')}</label>
              <Input
                id="permission-octal-input"
                value={octal}
                maxLength={3}
                autoFocus
                status={valid ? undefined : 'error'}
                onChange={(event) => setOctal(event.target.value.replace(/[^0-7]/g, '').slice(0, 3))}
              />
              <span className={valid ? '' : 'is-error'}>{t('files.permissionsNumericHint')}</span>
            </div>
          )}
          <div className="permission-preview">
            <span>{t('files.permissionsPreview')}</span>
            <strong>{valid ? octal : '---'}</strong>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

function entryPermissionOctal(entry: RemoteFileEntry) {
  if (entry.permission_octal && isPermissionOctal(entry.permission_octal)) {
    return entry.permission_octal
  }
  return permissionTextToOctal(entry.permissions) ?? '644'
}

function isPermissionOctal(value: string) {
  return /^[0-7]{3}$/.test(value)
}

function permissionTextToOctal(value?: string) {
  if (!value) {
    return null
  }
  const permissions = value.trim().slice(-9)
  if (permissions.length !== 9) {
    return null
  }
  return [permissions.slice(0, 3), permissions.slice(3, 6), permissions.slice(6, 9)]
    .map((part) => {
      let next = 0
      if (part[0] === 'r') next += 4
      if (part[1] === 'w') next += 2
      if (part[2] === 'x' || part[2] === 's' || part[2] === 't') next += 1
      return String(next)
    })
    .join('')
}

function octalToPermissionBits(value: string): PermissionBits {
  const safe = isPermissionOctal(value) ? value : '000'
  const [owner, group, others] = safe.split('').map((digit) => Number.parseInt(digit, 10))
  return {
    owner: digitToPermissionBits(owner),
    group: digitToPermissionBits(group),
    others: digitToPermissionBits(others),
  }
}

function digitToPermissionBits(value: number): Record<PermissionAction, boolean> {
  return {
    read: (value & permissionActionValues.read) !== 0,
    write: (value & permissionActionValues.write) !== 0,
    execute: (value & permissionActionValues.execute) !== 0,
  }
}

function permissionBitsToOctal(bits: PermissionBits) {
  return permissionRoles
    .map((role) => permissionActions.reduce(
      (total, action) => total + (bits[role][action] ? permissionActionValues[action] : 0),
      0,
    ))
    .join('')
}
