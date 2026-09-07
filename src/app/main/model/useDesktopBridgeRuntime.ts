import { useEffect, useRef, useState } from 'react'
import { getTermousBridge } from '#shared/bridge'
import type {
  AppBuildInfo,
  AppTheme,
  CoreFatalEvent,
  CoreStartupSnapshot,
  TrayCommand,
  TrayMenuState,
} from '#common/contracts'

interface UseDesktopBridgeRuntimeOptions {
  initialBuildInfo: AppBuildInfo | null
  initializing: boolean
  startupFailed: boolean
  startupFailureMessage?: string
  apiReady: boolean
  appearanceTheme: AppTheme
  onThemeChange: (theme: AppTheme) => void
  trayState: TrayMenuState
  onTrayCommand: (command: TrayCommand) => void
}

export function useDesktopBridgeRuntime({
  initialBuildInfo,
  initializing,
  startupFailed,
  startupFailureMessage,
  apiReady,
  appearanceTheme,
  onThemeChange,
  trayState,
  onTrayCommand,
}: UseDesktopBridgeRuntimeOptions) {
  const bridge = getTermousBridge()
  const [buildInfo, setBuildInfo] = useState<AppBuildInfo | null>(initialBuildInfo)
  const [nativeCoreFatal, setNativeCoreFatal] = useState<CoreFatalEvent | null>(null)
  const [startupAttemptId, setStartupAttemptId] = useState<string | null>(null)
  const onTrayCommandRef = useRef(onTrayCommand)

  useEffect(() => {
    onTrayCommandRef.current = onTrayCommand
  }, [onTrayCommand])

  useEffect(() => {
    let disposed = false
    let revision = -1
    setNativeCoreFatal(null)
    setStartupAttemptId(null)

    void bridge?.getBuildInfo?.()
      .then((info) => {
        if (!disposed && info?.version) {
          setBuildInfo(info)
        }
      })
      .catch(() => undefined)

    const coreBridge = bridge?.core
    const merge = (snapshot: CoreStartupSnapshot, fatal?: CoreFatalEvent | null) => {
      if (disposed || snapshot.revision <= revision) return
      revision = snapshot.revision
      setNativeCoreFatal(fatal ?? (snapshot.failure ? {
        title: snapshot.failure.code.startsWith('DB_') ? '数据库启动失败' : '后端连接异常',
        ...snapshot.failure,
      } : null))
    }
    const unsubscribeStatus = coreBridge?.onStatusChanged?.(merge)
    const cleanup = coreBridge?.onFatal((fatal) => {
      if (!disposed) {
        setNativeCoreFatal(fatal)
      }
    })
    void coreBridge?.status().then((status) => {
      if (disposed) return
      // 一次页面加载只确认自己的启动轮次，恢复重启期间旧页面不能放行新工作区。
      setStartupAttemptId(status.startup.attemptId)
      merge(status.startup, status.fatal)
    }).catch(() => {
      if (!disposed) setStartupAttemptId('')
    })

    return () => {
      disposed = true
      cleanup?.()
      unsubscribeStatus?.()
    }
  }, [bridge])

  useEffect(() => {
    if (initializing && !startupFailed && !nativeCoreFatal) {
      return
    }
    if (bridge?.core && startupAttemptId === null) return
    void bridge?.startup?.ready({
      failed: startupFailed,
      attemptId: startupAttemptId || undefined,
      ...(startupFailed && startupFailureMessage ? { message: startupFailureMessage } : {}),
    }).catch(() => undefined)
  }, [bridge, initializing, nativeCoreFatal, startupAttemptId, startupFailed, startupFailureMessage])

  useEffect(() => {
    if (initializing || !apiReady) {
      return
    }
    onThemeChange(appearanceTheme)
    void bridge?.appearance?.setTheme(appearanceTheme).catch(() => undefined)
  }, [apiReady, appearanceTheme, bridge, initializing, onThemeChange])

  useEffect(() => {
    void bridge?.tray?.updateState(trayState).catch(() => undefined)
  }, [bridge, trayState])

  useEffect(() => {
    const cleanup = bridge?.tray?.onCommand((command) => {
      if (isTrayCommand(command)) {
        onTrayCommandRef.current(command)
      }
    })
    return () => cleanup?.()
  }, [bridge])

  return {
    buildInfo,
    nativeCoreFatal,
  }
}

function isTrayCommand(command: unknown): command is TrayCommand {
  if (!command || typeof command !== 'object') {
    return false
  }
  const value = command as { type?: unknown; hostId?: unknown }
  if (value.type === 'connect-recent-host') {
    return typeof value.hostId === 'string' && value.hostId.length > 0
  }
  return value.type === 'open-app'
    || value.type === 'open-host-launcher'
    || value.type === 'open-forwards'
}
