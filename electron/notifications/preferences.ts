import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { validateNotificationPreferences, type NotificationPreferences } from '#common/contracts'

const defaults: NotificationPreferences = { enabled: true, agent: true, file: true, approval: true }

export class NotificationPreferencesStore {
  private value = { ...defaults }
  private pending: Promise<unknown> = Promise.resolve()
  private file: string
  private warn: () => void
  constructor(file: string, warn: () => void) { this.file = file; this.warn = warn }

  async load() {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (!value || typeof value !== 'object' || Object.keys(value).length !== 2 || !('schema_version' in value) || value.schema_version !== 1 || !('preferences' in value)) throw new Error('NOTIFICATION_PREFERENCES_INVALID')
      this.value = validateNotificationPreferences(value.preferences)
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') this.warn()
    }
  }
  get() { return { ...this.value } }
  set(input: unknown): Promise<NotificationPreferences> {
    const value = validateNotificationPreferences(input)
    const operation = this.pending.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true })
      const temporary = `${this.file}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify({ schema_version: 1, preferences: value }), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        await rename(temporary, this.file)
        this.value = value
        return this.get()
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') this.warn() })
      }
    })
    this.pending = operation.catch(() => undefined)
    return operation
  }
}
