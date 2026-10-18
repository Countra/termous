export interface LoginItemState {
  available: boolean
  enabled: boolean
  unavailable_reason: 'development' | 'unsupported_platform' | null
  requires_approval: boolean
}

export type LoginItemError = 'unavailable' | 'invalid_request' | 'read_failed' | 'write_failed' | 'not_applied'

export type LoginItemResponse =
  | { ok: true; value: LoginItemState }
  | { ok: false; error: LoginItemError }
