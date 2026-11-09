import { useEffect, useState } from 'react'
import type { DesktopControlsGateway, DesktopControlSnapshot } from '#common/contracts'

export function useDesktopControls(gateway: DesktopControlsGateway | undefined) {
  const [snapshot, setSnapshot] = useState<DesktopControlSnapshot | null>(null)
  useEffect(() => {
    setSnapshot(null)
    return gateway?.subscribe(setSnapshot)
  }, [gateway])
  return snapshot
}
