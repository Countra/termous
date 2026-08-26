import type {
  RemoteDesktopCredentialField,
  RemoteDesktopCredentials,
} from './viewerContracts.ts'

interface TargetAuthRequest {
  fields: RemoteDesktopCredentialField[]
  consume: (ticket: string) => Promise<{ password: string }>
  isCurrent: () => boolean
  submit: (credentials: RemoteDesktopCredentials) => void
  fallback: () => void
}

export class RemoteDesktopTargetAuthController {
  private ticket = ''
  private pending = false
  private revision = 0

  reset(ticket: string) {
    this.clear()
    this.ticket = ticket
  }

  clear() {
    this.revision += 1
    this.ticket = ''
    this.pending = false
  }

  async handleRequest(request: TargetAuthRequest) {
    if (this.pending) {
      return
    }
    if (!isPasswordOnlyRequest(request.fields) || !this.ticket) {
      request.fallback()
      return
    }
    const revision = this.revision
    const ticket = this.ticket
    this.ticket = ''
    this.pending = true
    try {
      const targetAuth = await request.consume(ticket)
      if (
        revision !== this.revision
        || !request.isCurrent()
      ) {
        return
      }
      if (!isValidPassword(targetAuth.password)) {
        request.fallback()
        return
      }
      request.submit({ password: targetAuth.password })
    } catch {
      if (revision === this.revision && request.isCurrent()) {
        request.fallback()
      }
    } finally {
      if (revision === this.revision) {
        this.pending = false
      }
    }
  }
}

function isPasswordOnlyRequest(fields: RemoteDesktopCredentialField[]) {
  return fields.length === 1
    && fields[0]?.id === 'password'
    && fields[0].kind === 'secret'
    && fields[0].required
}

function isValidPassword(password: unknown): password is string {
  return typeof password === 'string'
    && password.length > 0
    && new TextEncoder().encode(password).byteLength <= 4_096
}
