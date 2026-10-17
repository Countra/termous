import { useTranslation } from 'react-i18next'
import type { Ref } from 'react'
import { DetachedWindowPlaceholder } from '#shared/ui'

export function AgentDetachedPlaceholder({ ref, capture, busy, restoring, onReturn, onFocus }: {
  ref?: Ref<HTMLElement>; capture?: string; busy: boolean; restoring: boolean; onReturn: () => void; onFocus: () => void
}) {
  const { t } = useTranslation()
  return <DetachedWindowPlaceholder ref={ref} capture={capture} busy={busy} restoring={restoring} onReturn={onReturn} onFocus={onFocus}
    title={t('agent.window.detached')} description={t('agent.window.detachedDescription')} returnLabel={t('agent.window.returnHere')} focusLabel={t('agent.window.focus')} />
}
