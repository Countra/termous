import { useEffect, useState } from 'react'
import { Button, Descriptions, Space, Spin } from 'antd'
import { ShieldQuestion } from 'lucide-react'
import { RemoteClient, type HostKeyChallenge, type Session } from '#entities/remote-control'
import { remoteErrorText, type RemoteCopy } from '../model/copy'
import { RemoteFeedback } from './RemoteFeedback'

export function RemoteHostKey({ client, session, copy, changed }: { client: RemoteClient; session: Session; copy: RemoteCopy; changed(): void }) {
  const [challenge, setChallenge] = useState<HostKeyChallenge>()
  const [error, setError] = useState<unknown>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    void client.request({ operation: { case: 'session', value: { sessionId: session.id, generation: session.generation, action: 'host_key_read', challengeId: session.hostKeyChallengeId } } }).then(result => {
      if (active && result.result.case === 'hostKey') setChallenge(result.result.value)
    }).catch(reason => { if (active) setError(reason) })
    return () => { active = false }
  }, [client, session.id, session.generation, session.hostKeyChallengeId])
  const act = async (action: string) => {
    if (!challenge) return
    setBusy(true)
    try { await client.request({ operation: { case: 'session', value: { sessionId: session.id, generation: session.generation, action, challengeId: challenge.id, operationId: crypto.randomUUID() } } }); changed() } catch (reason) { setError(reason) } finally { setBusy(false) }
  }
  return <Space orientation="vertical" size="large"><ShieldQuestion size={32} /><h2>{copy.trustTitle}</h2>{challenge ? <><Descriptions column={1} items={[{ key: 'host', label: copy.host, children: `${challenge.host}:${challenge.port}` }, { key: 'algorithm', label: copy.algorithm, children: challenge.algorithm }, { key: 'fingerprint', label: copy.fingerprint, children: <code>{challenge.fingerprint}</code> }, ...(challenge.previousFingerprint ? [{ key: 'previous', label: copy.previousKey, children: <code>{challenge.previousFingerprint}</code> }] : [])]} /><Space><Button type="primary" danger={challenge.reason === 'changed'} loading={busy} onClick={() => void act(challenge.reason === 'changed' ? 'host_key_replace' : 'host_key_trust')}>{challenge.reason === 'changed' ? copy.replace : copy.trust}</Button><Button disabled={busy} onClick={() => void act('host_key_reject')}>{copy.reject}</Button></Space></> : !error ? <Spin /> : null}{error ? <RemoteFeedback message={remoteErrorText(copy, error)} /> : null}</Space>
}
