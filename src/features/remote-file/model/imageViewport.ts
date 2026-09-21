export interface ImageSize { width: number; height: number }
export interface ImageOffset { x: number; y: number }
export const MIN_IMAGE_SCALE = 0.01
export const MAX_IMAGE_SCALE = 6

export interface ImageView {
  // null 表示持续适应窗口；手动缩放以图片原始像素为基准。
  scale: number | null
  rotation: number
  offset: ImageOffset
}

export function fitImageScale(image: ImageSize | null, viewport: ImageSize, rotation: number): number {
  if (!image || image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return 1
  const sideways = Math.abs(rotation % 180) === 90
  const width = sideways ? image.height : image.width
  const height = sideways ? image.width : image.height
  return Math.min(1, Math.max(1, viewport.width - 36) / width, Math.max(1, viewport.height - 36) / height)
}

export function zoomImageView(view: ImageView, fitScale: number, factor: number, anchor: ImageOffset): ImageView {
  const current = view.scale ?? fitScale
  // 缩放边界不随窗口或旋转变化；自动适配低于下限时，也不能让缩小反而放大。
  const scale = Math.max(Math.min(MIN_IMAGE_SCALE, current), Math.min(MAX_IMAGE_SCALE, current * factor))
  if (scale === current) return view
  const ratio = scale / current
  return {
    ...view,
    scale,
    offset: {
      x: anchor.x - (anchor.x - view.offset.x) * ratio,
      y: anchor.y - (anchor.y - view.offset.y) * ratio,
    },
  }
}
