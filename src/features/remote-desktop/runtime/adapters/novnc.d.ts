declare module '@novnc/novnc' {
  interface RFBChannel {
    binaryType: BinaryType
    onclose: ((event: CloseEvent) => void) | null
    onerror: ((event: Event) => void) | null
    onmessage: ((event: MessageEvent) => void) | null
    onopen: ((event: Event) => void) | null
    readonly protocol: string
    readonly readyState: number | string

    close(code?: number, reason?: string): void
    send(data: string | Blob | BufferSource): void
  }

  interface RFBOptions {
    shared?: boolean
    credentials?: Partial<Record<'username' | 'password' | 'target', string>>
    wsProtocols?: string[]
  }

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket | RFBChannel, options?: RFBOptions)

    readonly capabilities: Record<string, boolean>
    background: string
    clipViewport: boolean
    compressionLevel: number
    focusOnClick: boolean
    qualityLevel: number
    resizeSession: boolean
    scaleViewport: boolean
    showDotCursor: boolean
    viewOnly: boolean

    approveServer(): void
    blur(): void
    clipboardPasteFrom(text: string): void
    disconnect(): void
    focus(options?: { preventScroll?: boolean }): void
    sendCredentials(credentials: Partial<Record<'username' | 'password' | 'target', string>>): void
    sendCtrlAltDel(): void
  }
}
