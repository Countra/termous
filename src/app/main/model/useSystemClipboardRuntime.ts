import { useEffect } from 'react'
import { systemClipboardCapabilities } from '#entities/system-clipboard'
import { getTermousBridge } from '#shared/bridge'

export function useSystemClipboardRuntime() {
  useEffect(() => systemClipboardCapabilities.connect(getTermousBridge()?.systemClipboard), [])
}
