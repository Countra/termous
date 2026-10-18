import { contextBridge } from 'electron'
import { createDetachedOwnerBridge } from '../../electron/detached-windows/preload'

contextBridge.exposeInMainWorld('termous', { detachedWindows: createDetachedOwnerBridge() })
