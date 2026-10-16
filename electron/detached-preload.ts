import { contextBridge } from 'electron'
import { createDetachedWindowBridge } from './detached-windows/preload'

contextBridge.exposeInMainWorld('termousDetached', createDetachedWindowBridge())
