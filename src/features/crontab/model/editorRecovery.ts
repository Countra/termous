import type { CrontabJob } from '#entities/crontab'

export function findReloadedCrontabJob(
  original: CrontabJob,
  jobs: CrontabJob[],
): CrontabJob | null {
  const matches = jobs.filter((job) => (
    job.line_number === original.line_number
    && job.expression === original.expression
    && job.command === original.command
    && job.enabled === original.enabled
    && job.editable
  ))
  return matches.length === 1 ? matches[0] : null
}
