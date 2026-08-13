import type { CrontabSnapshot } from '#entities/crontab'

export type CrontabSourceSnapshot = CrontabSnapshot & { content: string }

export function requireCrontabSourceSnapshot(
  snapshot: CrontabSnapshot,
  errorMessage: string,
): CrontabSourceSnapshot {
  if (typeof snapshot.content !== 'string') {
    throw new Error(errorMessage)
  }
  return snapshot as CrontabSourceSnapshot
}
