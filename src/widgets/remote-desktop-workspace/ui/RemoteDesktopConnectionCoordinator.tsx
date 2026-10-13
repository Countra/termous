import { useLayoutEffect, useState } from 'react'
import { useRemoteDesktopRuntime } from '#features/remote-desktop'
import { RemoteDesktopCredentialDialog } from './RemoteDesktopSecurityDialogs'
import { RemoteDesktopServerVerificationDialog } from './RemoteDesktopServerVerificationDialog'

interface RemoteDesktopConnectionCoordinatorProps {
  blocked?: boolean
  onBlockingChange?: (blocking: boolean) => void
}

export function RemoteDesktopConnectionCoordinator({ blocked = false, onBlockingChange }: RemoteDesktopConnectionCoordinatorProps) {
  const { sessions, viewerStates } = useRemoteDesktopRuntime()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const pending = sessions.flatMap((session) => {
    if (session.status === 'failed' || session.status === 'stopping' || session.status === 'reconnecting') return []
    const state = viewerStates[session.id]
    if (!state) return []
    const identity = [session.id, session.connection_generation]
    if (state.connection === 'verifying_server' && state.verification
      && (session.protocol !== 'rdp' || session.status === 'waiting_host_trust')) {
      return [{ session, kind: 'verification', key: JSON.stringify([...identity, 'verification', session.certificate?.challenge_id, state.verification]) }]
    }
    if (state.connection === 'credentials_required' && state.credentialFields.length) {
      return [{ session, kind: 'credentials', key: JSON.stringify([...identity, 'credentials', state.credentialFields]) }]
    }
    return []
  })
  // 保持正在处理的确认；后台新增会话或列表重排不能替换用户正在核对的目标。
  const current = pending.find((item) => item.key === selectedKey) ?? pending[0]
  const currentKey = current?.key ?? null
  const blocking = currentKey !== null
  useLayoutEffect(() => { setSelectedKey(currentKey) }, [currentKey])
  useLayoutEffect(() => {
    onBlockingChange?.(blocking)
    return () => onBlockingChange?.(false)
  }, [blocking, onBlockingChange])

  if (!current) return null
  return current.kind === 'verification'
    ? <RemoteDesktopServerVerificationDialog key={current.key} session={current.session} visible={!blocked} />
    : <RemoteDesktopCredentialDialog key={current.key} session={current.session} visible={!blocked} />
}
