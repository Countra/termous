import assert from 'node:assert/strict'
import test from 'node:test'
import { isLocalFileDrag } from '../features/workbench/workbenchFileDrag.ts'

test('工作站文件面板只接受本地文件拖入', () => {
  assert.equal(isLocalFileDrag(['Files']), true)
  assert.equal(isLocalFileDrag(['text/plain', 'Files']), true)
  assert.equal(isLocalFileDrag(['application/x-termous-remote-download']), false)
  assert.equal(isLocalFileDrag(['text/plain']), false)
  assert.equal(isLocalFileDrag([]), false)
})
