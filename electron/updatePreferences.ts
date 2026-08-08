import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  UpdateCheckInterval,
  UpdatePreferences,
  UpdatePreferencesPatch,
} from '#common/contracts'

const updatePreferencesSchemaVersion = 1
const dailyIntervalMs = 24 * 60 * 60 * 1000
const weeklyIntervalMs = 7 * dailyIntervalMs
const allowedIntervals = new Set<UpdateCheckInterval>(['startup', 'daily', 'weekly'])

interface PersistedUpdatePreferences extends UpdatePreferences {
  schema_version: number
}

export interface AutomaticUpdateSchedule {
  due: boolean
  next_check_at: string | null
}

export interface AutomaticUpdateScheduleInput {
  now: number
  checked_this_launch: boolean
}

export interface UpdatePreferencesStoreOptions {
  onReadError?: (error: unknown) => void
}

export class UpdatePreferencesValidationError extends Error {
  readonly code = 'UPDATE_PREFERENCES_INVALID'

  constructor() {
    super('更新偏好设置无效')
    this.name = 'UpdatePreferencesValidationError'
  }
}

export function createDefaultUpdatePreferences(): UpdatePreferences {
  return {
    automatic_check: true,
    check_interval: 'daily',
    automatic_download: false,
    last_checked_at: null,
    revision: 0,
  }
}

export function normalizeUpdatePreferences(value: unknown): UpdatePreferences {
  if (!isRecord(value)) {
    return createDefaultUpdatePreferences()
  }

  const defaults = createDefaultUpdatePreferences()
  const schemaVersion = toSafeInteger(value.schema_version)
  if (schemaVersion !== null && schemaVersion !== updatePreferencesSchemaVersion) {
    return defaults
  }

  return {
    automatic_check: typeof value.automatic_check === 'boolean'
      ? value.automatic_check
      : defaults.automatic_check,
    check_interval: isUpdateCheckInterval(value.check_interval)
      ? value.check_interval
      : defaults.check_interval,
    automatic_download: typeof value.automatic_download === 'boolean'
      ? value.automatic_download
      : defaults.automatic_download,
    last_checked_at: normalizeDate(value.last_checked_at),
    revision: toSafeInteger(value.revision) ?? defaults.revision,
  }
}

export function validateUpdatePreferencesPatch(value: unknown): UpdatePreferencesPatch {
  if (!isRecord(value)) {
    throw new UpdatePreferencesValidationError()
  }

  const allowedKeys = new Set(['automatic_check', 'check_interval', 'automatic_download'])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new UpdatePreferencesValidationError()
  }

  const patch: UpdatePreferencesPatch = {}
  if ('automatic_check' in value) {
    if (typeof value.automatic_check !== 'boolean') {
      throw new UpdatePreferencesValidationError()
    }
    patch.automatic_check = value.automatic_check
  }
  if ('check_interval' in value) {
    if (!isUpdateCheckInterval(value.check_interval)) {
      throw new UpdatePreferencesValidationError()
    }
    patch.check_interval = value.check_interval
  }
  if ('automatic_download' in value) {
    if (typeof value.automatic_download !== 'boolean') {
      throw new UpdatePreferencesValidationError()
    }
    patch.automatic_download = value.automatic_download
  }
  return patch
}

export function applyUpdatePreferencesPatch(
  current: UpdatePreferences,
  patch: UpdatePreferencesPatch,
): UpdatePreferences {
  const next = {
    ...current,
    ...patch,
  }
  if (
    next.automatic_check === current.automatic_check
    && next.check_interval === current.check_interval
    && next.automatic_download === current.automatic_download
  ) {
    return { ...current }
  }
  return {
    ...next,
    revision: current.revision + 1,
  }
}

export function recordSuccessfulUpdateCheck(
  current: UpdatePreferences,
  checkedAt: string,
): UpdatePreferences {
  const normalizedCheckedAt = normalizeDate(checkedAt)
  if (!normalizedCheckedAt) {
    throw new UpdatePreferencesValidationError()
  }
  if (normalizedCheckedAt === current.last_checked_at) {
    return { ...current }
  }
  return {
    ...current,
    last_checked_at: normalizedCheckedAt,
    revision: current.revision + 1,
  }
}

export function resolveAutomaticUpdateSchedule(
  preferences: UpdatePreferences,
  input: AutomaticUpdateScheduleInput,
): AutomaticUpdateSchedule {
  if (!preferences.automatic_check) {
    return { due: false, next_check_at: null }
  }

  const now = normalizeTimestamp(input.now)
  if (preferences.check_interval === 'startup') {
    return input.checked_this_launch
      ? { due: false, next_check_at: null }
      : { due: true, next_check_at: new Date(now).toISOString() }
  }

  const interval = preferences.check_interval === 'weekly'
    ? weeklyIntervalMs
    : dailyIntervalMs
  const lastCheckedAt = preferences.last_checked_at
    ? Date.parse(preferences.last_checked_at)
    : Number.NaN
  const nextCheckAt = Number.isFinite(lastCheckedAt)
    ? lastCheckedAt + interval
    : now

  return {
    due: now >= nextCheckAt,
    next_check_at: new Date(nextCheckAt).toISOString(),
  }
}

export class UpdatePreferencesStore {
  private readonly filePath: string
  private readonly options: UpdatePreferencesStoreOptions
  private snapshot: UpdatePreferences | null = null
  private loadPromise: Promise<UpdatePreferences> | null = null
  private writeTail: Promise<void> = Promise.resolve()

  constructor(
    filePath: string,
    options: UpdatePreferencesStoreOptions = {},
  ) {
    this.filePath = filePath
    this.options = options
  }

  load(): Promise<UpdatePreferences> {
    if (this.snapshot) {
      return Promise.resolve({ ...this.snapshot })
    }
    if (!this.loadPromise) {
      this.loadPromise = this.loadOnce().then((preferences) => {
        this.snapshot = preferences
        return { ...preferences }
      })
    }
    return this.loadPromise.then((preferences) => ({ ...preferences }))
  }

  getSnapshot(): UpdatePreferences {
    return { ...(this.snapshot ?? createDefaultUpdatePreferences()) }
  }

  update(patchInput: unknown): Promise<UpdatePreferences> {
    const patch = validateUpdatePreferencesPatch(patchInput)
    return this.enqueueWrite(async () => {
      const current = await this.load()
      const next = applyUpdatePreferencesPatch(current, patch)
      if (next.revision === current.revision) {
        return next
      }
      await this.writeAtomic(next)
      this.snapshot = next
      return { ...next }
    })
  }

  recordSuccessfulCheck(checkedAt: string): Promise<UpdatePreferences> {
    return this.enqueueWrite(async () => {
      const current = await this.load()
      const next = recordSuccessfulUpdateCheck(current, checkedAt)
      if (next.revision === current.revision) {
        return next
      }
      await this.writeAtomic(next)
      this.snapshot = next
      return { ...next }
    })
  }

  private enqueueWrite(
    operation: () => Promise<UpdatePreferences>,
  ): Promise<UpdatePreferences> {
    const result = this.writeTail.then(operation)
    this.writeTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async loadOnce(): Promise<UpdatePreferences> {
    try {
      const contents = await readFile(this.filePath, 'utf8')
      return normalizeUpdatePreferences(JSON.parse(contents))
    } catch (error) {
      if (error instanceof SyntaxError || isFileNotFoundError(error)) {
        return createDefaultUpdatePreferences()
      }
      try {
        this.options.onReadError?.(error)
      } catch {
        // 诊断回调不得反向阻断关于窗口和手动更新能力。
      }
      return createDefaultUpdatePreferences()
    }
  }

  private async writeAtomic(preferences: UpdatePreferences) {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    const persisted: PersistedUpdatePreferences = {
      schema_version: updatePreferencesSchemaVersion,
      ...preferences,
    }
    try {
      await writeFile(temporaryPath, `${JSON.stringify(persisted, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      await rename(temporaryPath, this.filePath)
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUpdateCheckInterval(value: unknown): value is UpdateCheckInterval {
  return typeof value === 'string' && allowedIntervals.has(value as UpdateCheckInterval)
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function normalizeTimestamp(value: number) {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function toSafeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function isFileNotFoundError(error: unknown) {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
  )
}
