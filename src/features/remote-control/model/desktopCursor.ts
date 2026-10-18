import type { DesktopCursor } from '@termous/remote-protocol/desktop'

export type CursorState = Omit<DesktopCursor, '$typeName' | 'png'> & { image?: string }
export function updateCursor(previous: CursorState | undefined, cursor: DesktopCursor): CursorState {
  if (cursor.kind === 'position' && previous) return { ...previous, x: cursor.x, y: cursor.y }
  return { ...cursor, image: cursor.png.length ? `data:image/png;base64,${btoa(String.fromCharCode(...cursor.png))}` : undefined }
}
