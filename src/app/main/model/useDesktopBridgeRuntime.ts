import { useEffect, useRef, useState } from 'react'
import { getTermousBridge } from '#shared/bridge'
import type {
  AppBuildInfo,
  AppTheme,
  CoreFatalEvent,
  TrayCommand,
  TrayMenuState,
} from '#common/contracts'

interface UseDesktopBridgeRuntimeOptions {
  initialBuildInfo: AppBuildInfo | null
  initializing: boolean
  startupFailed: boolean
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
  apiReady,
  appearanceTheme,
  onThemeChange,
  trayState,
  onTrayCommand,
}: UseDesktopBridgeRuntimeOptions) {
  const bridge = getTermousBridge()
  const [buildInfo, setBuildInfo] = useState<AppBuildInfo | null>(initialBuildInfo)
  const [nativeCoreFatal, setNativeCoreFatal] = useState<CoreFatalEvent | null>(null)
  const onTrayCommandRef = useRef(onTrayCommand)

  useEffect(() => {
    onTrayCommandRef.current = onTrayCommand
  }, [onTrayCommand])

  useEffect(() => {
    let disposed = false
    setNativeCoreFatal(null)

    void bridge?.getBuildInfo?.()
      .then((info) => {
        if (!disposed && info?.version) {
          setBuildInfo(info)
        }
      })
      .catch(() => undefined)

    const coreBridge = bridge?.core
    void coreBridge?.getFatal()
      .then((fatal) => {
        if (!disposed && fatal) {
          setNativeCoreFatal(fatal)
        }
      })
      .catch(() => undefined)

    const cleanup = coreBridge?.onFatal((fatal) => {
      if (!disposed) {
        setNativeCoreFatal(fatal)
      }
    })

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [bridge])

  useEffect(() => {
    if (initializing && !startupFailed && !nativeCoreFatal) {
      return
    }
    void bridge?.startup?.ready().catch(() => undefined)
  }, [bridge, initializing, nativeCoreFatal, startupFailed])

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
