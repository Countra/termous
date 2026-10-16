import { contextBridge } from 'electron'
import { createSystemClipboardCapabilitiesBridge } from '../../electron/system-clipboard/preload.ts'

contextBridge.exposeInMainWorld('clipboardCapabilities', createSystemClipboardCapabilitiesBridge())
