export interface HostKeyEndpoint {
  canonical_host: string
  port: number
}

export type HostKeyConsumerType = 'session' | 'sftp' | 'forward' | 'alias_sync'
export type HostKeyEndpointRole = 'target' | 'jump'
export type HostKeyChallengeReason = 'unknown' | 'changed'
export type HostKeyChallengeState = 'pending' | 'trusted' | 'replaced' | 'rejected' | 'expired' | 'cancelled'
export type HostKeyDecisionAction = 'trust' | 'replace' | 'reject'
export type HostKeyEventType = 'challenge_upsert' | 'challenge_resolved' | 'challenge_expired' | 'trust_deleted'

export interface HostKeyObservationContext {
  consumer_type: HostKeyConsumerType
  consumer_id: string
  host_id?: string
  role: HostKeyEndpointRole
}

export interface HostKeyMaterial {
  algorithm: string
  fingerprint_sha256: string
}

export interface HostKeyChallenge {
  id: string
  instance_id: string
  endpoint: HostKeyEndpoint
  reason: HostKeyChallengeReason
  observed_key: HostKeyMaterial
  existing_trust_id?: string
  existing_fingerprint_sha256?: string
  expected_revision?: number
  contexts: HostKeyObservationContext[]
  context_count: number
  state: HostKeyChallengeState
  created_at: string
  expires_at: string
}

export interface HostKeyResolution {
  challenge_id: string
  state: HostKeyChallengeState
  trust_record_id?: string
  resolved_at: string
  error_code?: string
}

export interface HostKeyChallengeSnapshot {
  instance_id: string
  snapshot_revision: number
  challenges: HostKeyChallenge[]
}

export interface HostKeyEvent {
  instance_id: string
  snapshot_revision: number
  type: HostKeyEventType
  challenge?: HostKeyChallenge
  resolution?: HostKeyResolution
  trust_id?: string
}

export interface HostKeyTrustRecord {
  id: string
  endpoint: HostKeyEndpoint
  key: HostKeyMaterial
  revision: number
  first_seen_at: string
  last_seen_at: string
  created_at: string
  updated_at: string
}
