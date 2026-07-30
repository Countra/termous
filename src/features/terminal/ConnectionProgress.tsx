import { CheckCircle2, Circle, CircleDashed, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Session, SessionPhase } from '../../types/domain'

const sshPhaseOrder: SessionPhase[] = [
  'queued',
  'resolving_auth',
  'dialing',
  'ssh_handshake_auth',
  'requesting_pty',
  'starting_shell',
  'ready',
]

const localPhaseOrder: SessionPhase[] = ['queued', 'starting_local_shell', 'ready']

export function ConnectionProgress({ session, showReady = false }: { session: Session | null; showReady?: boolean }) {
  const { t } = useTranslation()
  if (!session || session.status === 'disconnected' || (session.status === 'connected' && !showReady)) {
    return null
  }
  const phaseOrder = phasesForSession(session)
  const currentPhase = session.phase ?? 'queued'
  const currentIndex = phaseOrder.indexOf(currentPhase)
  const progress = Math.max(0, Math.min(100, session.progress ?? 0))
  const headline = session.proxy_id && currentPhase === 'dialing'
    ? t(session.jump_host_id
      ? 'connection.proxyDialingJumpHost'
      : 'connection.proxyDialingTarget')
    : t(`connection.phase.${currentPhase}`)

  return (
    <div className="connection-progress" aria-live="polite">
      <div className="connection-progress-head">
        <span>{headline}</span>
        <strong>{progress}%</strong>
      </div>
      <div className="connection-progress-bar">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="connection-phase-row">
        {phaseOrder.map((phase, index) => {
          const state = phaseState(session, index, currentIndex)
          const Icon = state === 'done' ? CheckCircle2 : state === 'failed' ? XCircle : state === 'active' ? CircleDashed : Circle
          return (
            <span key={phase} className={`connection-phase is-${state}`} title={t(`connection.phase.${phase}`)}>
              <Icon size={13} aria-hidden="true" />
              <span>{t(`connection.phaseShort.${phase}`)}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

function phasesForSession(session: Session) {
  const base = session.kind === 'local' ? localPhaseOrder : sshPhaseOrder
  if (session.status === 'failed') {
    return [...base.filter((phase) => phase !== 'ready'), 'failed' as const]
  }
  return base
}

function phaseState(session: Session, index: number, currentIndex: number) {
  if (session.status === 'connected') {
    return index <= currentIndex ? 'done' : 'idle'
  }
  if (session.status === 'failed') {
    return index === currentIndex ? 'failed' : index < currentIndex ? 'done' : 'idle'
  }
  if (currentIndex < 0) {
    return 'idle'
  }
  if (index < currentIndex) {
    return 'done'
  }
  if (index === currentIndex) {
    return 'active'
  }
  return 'idle'
}
