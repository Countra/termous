export interface DesktopViewportGeometry {
  left: number
  top: number
  width: number
  height: number
  remoteX: number
  remoteY: number
  remoteWidth: number
  remoteHeight: number
  displayEpoch: number
}

export function projectDesktopPointer(x: number, y: number, epoch: number, geometry: DesktopViewportGeometry) {
  if (!Object.values(geometry).every(Number.isFinite) || geometry.displayEpoch !== epoch
    || geometry.width <= 0 || geometry.height <= 0 || geometry.remoteWidth <= 0 || geometry.remoteHeight <= 0
    || x < geometry.remoteX || y < geometry.remoteY
    || x >= geometry.remoteX + geometry.remoteWidth || y >= geometry.remoteY + geometry.remoteHeight) return null
  return { x: geometry.left + (x - geometry.remoteX) * geometry.width / geometry.remoteWidth,
    y: geometry.top + (y - geometry.remoteY) * geometry.height / geometry.remoteHeight }
}
