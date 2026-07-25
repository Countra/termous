import { App as AntdApp } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  UpdatePreferences,
  UpdatePreferencesPatch,
} from '../../../electron/updateTypes'
import {
  type PendingPreferenceValues,
  type UpdatePreferenceKey,
} from './updateSettingsHelpers'
import { UpdateSettingsView } from './UpdateSettingsView'
import './update-settings.css'

export interface UpdatePreferencesRuntime {
  generation: number
  loadFailed: boolean
  preferences?: UpdatePreferences | null
  retry: () => Promise<boolean>
  setPreferences: (patch: UpdatePreferencesPatch) => Promise<UpdatePreferences>
}

interface UpdateSettingsProps {
  updateRuntime?: UpdatePreferencesRuntime | null
}

export function UpdateSettings({
  updateRuntime = null,
}: UpdateSettingsProps) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const incomingPreferences = updateRuntime?.preferences ?? null
  const runtimeGeneration = updateRuntime?.generation ?? -1
  const [savedPreferences, setSavedPreferences] = useState<UpdatePreferences | null>(incomingPreferences)
  const [pendingPreferenceValues, setPendingPreferenceValues] = useState<PendingPreferenceValues>({})
  const [retrying, setRetrying] = useState(false)
  const incomingPreferencesRef = useRef(incomingPreferences)
  const pendingPreferenceKeysRef = useRef(new Set<UpdatePreferenceKey>())
  const runtimeGenerationRef = useRef(runtimeGeneration)
  incomingPreferencesRef.current = incomingPreferences

  useEffect(() => {
    runtimeGenerationRef.current = runtimeGeneration
    pendingPreferenceKeysRef.current.clear()
    setPendingPreferenceValues({})
    setRetrying(false)
    setSavedPreferences(incomingPreferencesRef.current)
  }, [runtimeGeneration])

  useEffect(() => {
    if (!incomingPreferences) {
      return
    }
    setSavedPreferences((current) => (
      !current || incomingPreferences.revision >= current.revision
        ? incomingPreferences
        : current
    ))
  }, [incomingPreferences])

  const preferences = useMemo(
    () => savedPreferences
      ? { ...savedPreferences, ...pendingPreferenceValues }
      : null,
    [pendingPreferenceValues, savedPreferences],
  )

  const savePreference = async <Key extends UpdatePreferenceKey>(
    key: Key,
    value: UpdatePreferences[Key],
  ) => {
    if (
      !updateRuntime
      || !savedPreferences
      || pendingPreferenceKeysRef.current.has(key)
    ) {
      return
    }

    pendingPreferenceKeysRef.current.add(key)
    const operationGeneration = runtimeGenerationRef.current
    setPendingPreferenceValues((current) => ({ ...current, [key]: value }))
    try {
      const next = await updateRuntime.setPreferences({
        [key]: value,
      } as UpdatePreferencesPatch)
      if (runtimeGenerationRef.current !== operationGeneration) {
        return
      }
      setSavedPreferences((current) => (
        !current || next.revision >= current.revision ? next : current
      ))
    } catch {
      if (runtimeGenerationRef.current !== operationGeneration) {
        return
      }
      notification.error({
        key: `update-preference-${key}`,
        title: t('settings.update.preferencesSaveFailed'),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
    } finally {
      if (runtimeGenerationRef.current === operationGeneration) {
        pendingPreferenceKeysRef.current.delete(key)
        setPendingPreferenceValues((current) => {
          const next = { ...current }
          delete next[key]
          return next
        })
      }
    }
  }

  const retryLoading = async () => {
    if (!updateRuntime || retrying) {
      return
    }
    setRetrying(true)
    try {
      await updateRuntime.retry()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <UpdateSettingsView
      t={t}
      runtimeAvailable={Boolean(updateRuntime)}
      runtimeFailed={updateRuntime?.loadFailed ?? false}
      retrying={retrying}
      preferences={preferences}
      pendingPreferenceValues={pendingPreferenceValues}
      onRetry={() => void retryLoading()}
      onSavePreference={(key, value) => void savePreference(key, value)}
    />
  )
}
