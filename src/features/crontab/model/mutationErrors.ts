import { TermousApiError } from '#shared/api'

const uncertainTransportCodes = new Set([
  'REQUEST_TIMEOUT',
  'NETWORK_ERROR',
])

export function isCrontabWriteUncertainError(error: unknown) {
  return error instanceof TermousApiError && (
    error.code === 'CRONTAB_WRITE_UNCERTAIN'
    || error.status === 0 && uncertainTransportCodes.has(error.code)
  )
}
