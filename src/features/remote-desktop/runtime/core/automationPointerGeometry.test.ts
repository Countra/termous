import assert from 'node:assert/strict'
import test from 'node:test'
import { projectDesktopPointer } from './automationPointerGeometry.ts'

test('远端坐标按画面矩形映射，支持缩放、留白与裁剪原点', () => {
  const geometry = { left: 100, top: 60, width: 400, height: 300, remoteX: 200, remoteY: 100, remoteWidth: 800, remoteHeight: 600, displayEpoch: 2 }
  assert.deepEqual(projectDesktopPointer(400, 300, 2, geometry), { x: 200, y: 160 })
  for (const [x, y] of [[199, 100], [200, 99], [1000, 100], [200, 700]]) assert.equal(projectDesktopPointer(x, y, 2, geometry), null)
  assert.equal(projectDesktopPointer(400, 300, 1, geometry), null)
  assert.equal(projectDesktopPointer(400, 300, 2, { ...geometry, width: 0 }), null)
  assert.equal(projectDesktopPointer(400, 300, 2, { ...geometry, left: NaN }), null)
})
