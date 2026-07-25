import { App as AntdApp } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  UpdatePreferences,
  UpdatePreferencesPatch,
  UpdateSnapshot,
} from '../../../electron/updateTypes'
import type { AppBuildInfo } from '../../types/domain'
import {
  RELEASES_URL,
  resolveUpdatePhase,
  updateErrorLabel,
  type PendingPreferenceValues,
  type UpdatePreferenceKey,
  type UpdateWindowIntent,
} from './aboutSettingsHelpers'
import { AboutSettingsView } from './AboutSettingsView'
import './about-settings.css'

export interface AboutUpdateRuntime {
  snapshot: UpdateSnapshot | null
  preferences?: UpdatePreferences | null
  check: () => Promise<UpdateSnapshot>
  setPreferences: (patch: UpdatePreferencesPatch) => Promise<UpdatePreferences>
  openWindow: (intent?: UpdateWindowIntent) => Promise<boolean>
  openReleasePage: () => Promise<boolean>
}

interface AboutSettingsProps {
  appVersion: string
  buildInfo?: AppBuildInfo | null
  updateRuntime?: AboutUpdateRuntime | null
}

export function AboutSettings({
  appVersion,
  buildInfo = null,
  updateRuntime = null,
}: AboutSettingsProps) {
  const { i18n, t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const snapshot = updateRuntime?.snapshot ?? null
  const incomingPreferences = updateRuntime?.preferences ?? snapshot?.preferences ?? null
  const [savedPreferences, setSavedPreferences] = useState<UpdatePreferences | null>(incomingPreferences)
  const [pendingPreferenceValues, setPendingPreferenceValues] = useState<PendingPreferenceValues>({})
  const pendingPreferenceKeysRef = useRef(new Set<UpdatePreferenceKey>())
  const [checking, setChecking] = useState(false)
  const [openingIntent, setOpeningIntent] = useState<UpdateWindowIntent | null>(null)
  const [openingReleasePage, setOpeningReleasePage] = useState(false)

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
  const phase = resolveUpdatePhase(snapshot, Boolean(updateRuntime), buildInfo)
  const updateSupported = Boolean(
    updateRuntime
    && buildInfo?.update_supported !== false
    && phase !== 'unsupported',
  )
  const locale = i18n.resolvedLanguage || i18n.language
  const productName = buildInfo?.product_name || 'Termous'
  const version = buildInfo?.version || appVersion
  const checkBusy = checking || phase === 'checking'

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
    setPendingPreferenceValues((current) => ({ ...current, [key]: value }))
    try {
      const next = await updateRuntime.setPreferences({
        [key]: value,
      } as UpdatePreferencesPatch)
      setSavedPreferences((current) => (
        !current || next.revision >= current.revision ? next : current
      ))
    } catch {
      notification.error({
        key: `about-update-preference-${key}`,
        title: t('settings.about.preferencesSaveFailed'),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
    } finally {
      pendingPreferenceKeysRef.current.delete(key)
      setPendingPreferenceValues((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
    }
  }

  const handleCheck = async () => {
    if (!updateRuntime || checkBusy) {
      return
    }
    setChecking(true)
    try {
      const next = await updateRuntime.check()
      if (next.phase === 'up_to_date') {
        notification.success({
          key: 'about-update-check-complete',
          title: t('settings.about.alreadyLatest'),
          duration: 3,
          role: 'status',
          className: 'termous-notification',
        })
      } else if (next.phase === 'error') {
        notification.error({
          key: 'about-update-check-failed',
          title: t('settings.about.checkFailed'),
          description: updateErrorLabel(next.error_code, t),
          duration: 5,
          role: 'alert',
          className: 'termous-notification',
        })
      }
    } catch {
      notification.error({
        key: 'about-update-check-failed',
        title: t('settings.about.checkFailed'),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
    } finally {
      setChecking(false)
    }
  }

  const handleOpenUpdate = async (intent: UpdateWindowIntent) => {
    if (!updateRuntime || openingIntent) {
      return
    }
    setOpeningIntent(intent)
    try {
      const opened = await updateRuntime.openWindow(intent)
      if (!opened) {
        throw new Error('update_window_not_opened')
      }
    } catch {
      notification.error({
        key: 'about-update-open-failed',
        title: t('settings.about.openUpdateFailed'),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
    } finally {
      setOpeningIntent(null)
    }
  }

  const handleOpenReleasePage = async () => {
    if (openingReleasePage) {
      return
    }
    if (!updateRuntime) {
      window.open(RELEASES_URL, '_blank', 'noopener,noreferrer')
      return
    }
    setOpeningReleasePage(true)
    try {
      const opened = await updateRuntime.openReleasePage()
      if (!opened) {
        throw new Error('release_page_not_opened')
      }
    } catch {
      notification.error({
        key: 'about-update-release-page-failed',
        title: t('settings.about.openReleaseFailed'),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
    } finally {
      setOpeningReleasePage(false)
    }
  }

  return (
    <AboutSettingsView
      t={t}
      locale={locale}
      productName={productName}
      version={version}
      buildInfo={buildInfo}
      snapshot={snapshot}
      preferences={preferences}
      phase={phase}
      updateSupported={updateSupported}
      checking={checking}
      openingIntent={openingIntent}
      openingReleasePage={openingReleasePage}
      pendingPreferenceValues={pendingPreferenceValues}
      onCheck={() => void handleCheck()}
      onOpenUpdate={(intent) => void handleOpenUpdate(intent)}
      onOpenReleasePage={() => void handleOpenReleasePage()}
      onSavePreference={(key, value) => void savePreference(key, value)}
    />
  )
}
