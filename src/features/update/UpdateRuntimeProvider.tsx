import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { App as AntdApp, Button } from 'antd'
import { useTranslation } from 'react-i18next'
import type {
  UpdatePreferences,
  UpdatePreferencesPatch,
  UpdateSnapshot,
} from '../../../electron/updateTypes'
import type { UpdateWindowIntent } from '../../../electron/updateWindow'
import {
  mergeUpdatePreferencesByRevision,
  mergeUpdateRuntimeSnapshot,
  selectUpdateNotification,
  updateNotificationStorageKey,
} from './updateRuntimeState'
import {
  UpdateRuntimeContext,
  type UpdateRuntimeBridge,
  type UpdateRuntimeValue,
} from './useUpdateRuntime'

export interface UpdateNotificationStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

interface UpdateRuntimeProviderProps {
  bridge: UpdateRuntimeBridge | null
  children: ReactNode
  notificationStorage?: UpdateNotificationStorage | null
}

interface RuntimeState {
  bridge: UpdateRuntimeBridge | null
  latestPreferences: UpdatePreferences | null
  snapshot: UpdateSnapshot | null
}

export function UpdateRuntimeProvider({
  bridge,
  children,
  notificationStorage,
}: UpdateRuntimeProviderProps) {
  const { notification } = AntdApp.useApp()
  const { t, i18n } = useTranslation()
  const [runtimeState, setRuntimeState] = useState<RuntimeState>(() => ({
    bridge,
    latestPreferences: null,
    snapshot: null,
  }))
  const notifiedKeysRef = useRef(new Set<string>())
  const storage = useMemo(
    () => notificationStorage === undefined
      ? readSessionStorage()
      : notificationStorage,
    [notificationStorage],
  )
  const snapshot = runtimeState.bridge === bridge
    ? runtimeState.snapshot
    : null

  const applySnapshot = useCallback((incoming: UpdateSnapshot) => {
    setRuntimeState((current) => reconcileRuntimeState(current, bridge, incoming))
  }, [bridge])

  useEffect(() => {
    if (!bridge) {
      return undefined
    }
    try {
      return bridge.subscribe(applySnapshot)
    } catch {
      console.error('[termous:update] 订阅更新状态失败')
      return undefined
    }
  }, [applySnapshot, bridge])

  const checkForUpdates = useCallback(async () => {
    if (!bridge) {
      return null
    }
    const incoming = await bridge.check()
    applySnapshot(incoming)
    return incoming
  }, [applySnapshot, bridge])

  const setUpdatePreferences = useCallback(async (
    patch: UpdatePreferencesPatch,
  ) => {
    if (!bridge) {
      return null
    }
    const preferences = await bridge.setPreferences(patch)
    setRuntimeState((current) => reconcilePreferences(
      current,
      bridge,
      preferences,
    ))
    return preferences
  }, [bridge])

  const openUpdateWindow = useCallback((
    intent: UpdateWindowIntent = 'inspect',
  ) => bridge?.openWindow(intent) ?? Promise.resolve(false), [bridge])

  const openReleasePage = useCallback(
    () => bridge?.openReleasePage() ?? Promise.resolve(false),
    [bridge],
  )

  useEffect(() => {
    const event = selectUpdateNotification(snapshot)
    if (!bridge || !event) {
      return
    }
    const key = updateNotificationStorageKey(event)
    if (notifiedKeysRef.current.has(key)) {
      return
    }
    notifiedKeysRef.current.add(key)
    if (!reserveNotification(storage, key)) {
      return
    }

    const chinese = i18n.resolvedLanguage?.startsWith('zh') ?? false
    const openAction = (
      <Button
        type="link"
        size="small"
        onClick={() => {
          void bridge.openWindow('inspect')
            .then((opened) => {
              if (opened) {
                notification.destroy(key)
              }
            })
            .catch(() => {
              console.error('[termous:update] 打开更新窗口失败')
            })
        }}
      >
        {t('update.global.view', {
          defaultValue: chinese ? '查看更新' : 'View update',
        })}
      </Button>
    )

    if (event.type === 'available') {
      notification.info({
        key,
        title: t('update.global.availableTitle', {
          version: event.version,
          defaultValue: chinese
            ? `发现新版本 ${event.version}`
            : `Termous ${event.version} is available`,
        }),
        description: t('update.global.availableDescription', {
          version: event.version,
          defaultValue: chinese
            ? '新版本已准备好下载。'
            : 'A new version is ready to download.',
        }),
        actions: openAction,
        duration: 6,
        role: 'status',
        className: 'termous-notification',
      })
      return
    }

    notification.success({
      key,
      title: t('update.global.downloadedTitle', {
        version: event.version,
        defaultValue: chinese ? '更新已下载' : 'Update downloaded',
      }),
      description: t('update.global.downloadedDescription', {
        version: event.version,
        defaultValue: chinese
          ? `Termous ${event.version} 已准备好安装。`
          : `Termous ${event.version} is ready to install.`,
      }),
      actions: openAction,
      duration: 0,
      role: 'status',
      className: 'termous-notification',
    })
  }, [bridge, i18n.resolvedLanguage, notification, snapshot, storage, t])

  const value = useMemo<UpdateRuntimeValue>(() => ({
    bridgeAvailable: Boolean(bridge),
    initialized: Boolean(snapshot),
    snapshot,
    checkForUpdates,
    setUpdatePreferences,
    openUpdateWindow,
    openReleasePage,
  }), [
    bridge,
    checkForUpdates,
    openReleasePage,
    openUpdateWindow,
    setUpdatePreferences,
    snapshot,
  ])

  return (
    <UpdateRuntimeContext.Provider value={value}>
      {children}
    </UpdateRuntimeContext.Provider>
  )
}

function reconcileRuntimeState(
  current: RuntimeState,
  bridge: UpdateRuntimeBridge | null,
  incoming: UpdateSnapshot,
): RuntimeState {
  const sameBridge = current.bridge === bridge
  let snapshot = mergeUpdateRuntimeSnapshot(
    sameBridge ? current.snapshot : null,
    incoming,
  )
  const latestPreferences = sameBridge && current.latestPreferences
    ? mergeUpdatePreferencesByRevision(
        current.latestPreferences,
        snapshot.preferences,
      )
    : snapshot.preferences
  if (latestPreferences !== snapshot.preferences) {
    snapshot = {
      ...snapshot,
      preferences: latestPreferences,
    }
  }
  return {
    bridge,
    latestPreferences,
    snapshot,
  }
}

function reconcilePreferences(
  current: RuntimeState,
  bridge: UpdateRuntimeBridge,
  incoming: UpdatePreferences,
): RuntimeState {
  const sameBridge = current.bridge === bridge
  const latestPreferences = sameBridge && current.latestPreferences
    ? mergeUpdatePreferencesByRevision(current.latestPreferences, incoming)
    : { ...incoming }
  const snapshot = sameBridge && current.snapshot
    ? {
        ...current.snapshot,
        preferences: mergeUpdatePreferencesByRevision(
          current.snapshot.preferences,
          latestPreferences,
        ),
      }
    : null
  return {
    bridge,
    latestPreferences,
    snapshot,
  }
}

function readSessionStorage(): UpdateNotificationStorage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function reserveNotification(
  storage: UpdateNotificationStorage | null,
  key: string,
) {
  if (!storage) {
    return true
  }
  try {
    if (storage.getItem(key) !== null) {
      return false
    }
    storage.setItem(key, '1')
    return true
  } catch {
    // sessionStorage 不可用时退回当前 Provider 生命周期内去重。
    return true
  }
}
