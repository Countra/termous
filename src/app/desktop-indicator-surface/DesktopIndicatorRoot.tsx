import { useEffect, useState } from 'react'
import type { DesktopIndicatorState } from '#common/contracts'
import { getDesktopIndicatorBridge } from '#shared/bridge'
import { DesktopIndicator } from '#features/desktop-control'
import { TermousUiProvider } from '#app/ui-runtime'
import styles from './DesktopIndicatorRoot.module.scss'

export default function DesktopIndicatorRoot() {
  const bridge = getDesktopIndicatorBridge()
  const [state, setState] = useState<DesktopIndicatorState | null>(null)
  useEffect(() => {
    document.documentElement.classList.add(styles.surface)
    if (!bridge) return () => document.documentElement.classList.remove(styles.surface)
    let active = true
    const accept = (value: DesktopIndicatorState) => {
      if (active) setState(previous => previous && previous.revision > value.revision ? previous : value)
    }
    const stop = bridge.subscribe(accept)
    void bridge.state().then(accept).catch(() => { if (active) setState(null) })
    return () => { active = false; stop(); document.documentElement.classList.remove(styles.surface) }
  }, [bridge])
  if (!state || !bridge) return null
  return <TermousUiProvider theme={state.theme} language={state.language}>
    <DesktopIndicator key={`${state.instance_id}:${state.control?.reference}`} state={state} bridge={bridge} />
  </TermousUiProvider>
}
