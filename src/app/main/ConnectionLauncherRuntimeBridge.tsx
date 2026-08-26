import {
  HostLauncherModal,
  type HostLauncherModalProps,
} from '#features/hosts'
import { useRemoteDesktopRuntime } from '#features/remote-desktop'
import { useEffect, useRef } from 'react'

interface ConnectionLauncherRuntimeBridgeProps
  extends Omit<HostLauncherModalProps, 'onOpenRemoteDesktopProfile'> {
  onRemoteDesktopConnected: () => void
  onRemoteDesktopConnectionError: (error: unknown) => void
}

export function ConnectionLauncherRuntimeBridge({
  onRemoteDesktopConnected,
  onRemoteDesktopConnectionError,
  ...launcherProps
}: ConnectionLauncherRuntimeBridgeProps) {
  const remoteDesktop = useRemoteDesktopRuntime()
  const openGenerationRef = useRef(0)
  const launcherOpenRef = useRef(false)

  useEffect(() => {
    openGenerationRef.current += 1
    launcherOpenRef.current = launcherProps.open
    return () => {
      launcherOpenRef.current = false
      openGenerationRef.current += 1
    }
  }, [launcherProps.instanceKey, launcherProps.open])

  const closeLauncher = () => {
    launcherOpenRef.current = false
    openGenerationRef.current += 1
    launcherProps.onClose()
  }

  return (
    <HostLauncherModal
      {...launcherProps}
      onClose={closeLauncher}
      onOpenRemoteDesktopProfile={async (profileId) => {
        const openGeneration = openGenerationRef.current
        try {
          await remoteDesktop.createSession(profileId)
        } catch (error) {
          if (
            launcherOpenRef.current
            && openGenerationRef.current === openGeneration
          ) {
            onRemoteDesktopConnectionError(error)
          }
          throw error
        }
        if (
          launcherOpenRef.current
          && openGenerationRef.current === openGeneration
        ) {
          onRemoteDesktopConnected()
        }
      }}
    />
  )
}
