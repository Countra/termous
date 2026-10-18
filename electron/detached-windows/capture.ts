import { BrowserWindow, type WebContents } from 'electron'
import { setTimeout, clearTimeout } from 'node:timers'
import type { DetachedRect } from '#common/contracts'

export async function captureDetachedWorkspace(contents: WebContents, rect?: DetachedRect): Promise<string | undefined> {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // 某些 Windows 合成器会拒绝局部 capturePage。先截取内存帧，再按实际图像比例裁出工作区。
    // 对外只返回裁剪结果，不保存包含其他页面区域的完整帧。
    const zoom = contents.getZoomFactor()
    const image = await Promise.race([
      contents.capturePage(undefined, { stayAwake: true }),
      new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 1500) }),
    ])
    const bounds = BrowserWindow.fromWebContents(contents)?.getContentBounds()
    if (!image || image.isEmpty() || !bounds?.width || !bounds.height) return
    const size = image.getSize()
    const scaleX = size.width / bounds.width * zoom
    const scaleY = size.height / bounds.height * zoom
    const x = Math.max(0, Math.min(size.width - 1, Math.floor(rect.x * scaleX)))
    const y = Math.max(0, Math.min(size.height - 1, Math.floor(rect.y * scaleY)))
    return image.crop({ x, y, width: Math.min(size.width - x, Math.ceil(rect.width * scaleX)),
      height: Math.min(size.height - y, Math.ceil(rect.height * scaleY)) }).toDataURL()
  } catch { return undefined }
  finally { clearTimeout(timer) }
}
