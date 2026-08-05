export type ExternalUrlValidationError =
  | 'external_url_invalid'
  | 'external_url_too_long'
  | 'external_url_protocol_not_allowed'
  | 'external_url_credentials_not_allowed'

export type ExternalUrlOpenError =
  | ExternalUrlValidationError
  | 'external_url_sender_not_allowed'
  | 'external_url_open_failed'

export type ExternalUrlOpenResult =
  | { ok: true }
  | { ok: false; error: ExternalUrlOpenError }

export type ExternalUrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; error: ExternalUrlValidationError }
