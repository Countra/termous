import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWorkbenchFileSelection } from './workbenchFileSelection.ts'

const paths = ['/a', '/b', '/c', '/d']

test('工作台文件选择支持 Ctrl 和 Command 切换多选', () => {
  const ctrlSelection = resolveWorkbenchFileSelection(paths, ['/a'], '/a', '/c', {
    ctrlKey: true,
  })
  assert.deepEqual(ctrlSelection, {
    selectedPaths: ['/a', '/c'],
    anchorPath: '/c',
  })

  assert.deepEqual(
    resolveWorkbenchFileSelection(paths, ctrlSelection.selectedPaths, '/c', '/a', {
      metaKey: true,
    }),
    {
      selectedPaths: ['/c'],
      anchorPath: '/a',
    },
  )
})

test('工作台文件选择支持 Shift 范围及追加范围', () => {
  assert.deepEqual(
    resolveWorkbenchFileSelection(paths, ['/b'], '/b', '/d', { shiftKey: true }),
    {
      selectedPaths: ['/b', '/c', '/d'],
      anchorPath: '/b',
    },
  )
  assert.deepEqual(
    resolveWorkbenchFileSelection(paths, ['/a'], '/a', '/c', {
      ctrlKey: true,
      shiftKey: true,
    }),
    {
      selectedPaths: ['/a', '/b', '/c'],
      anchorPath: '/a',
    },
  )
})

test('工作台右键保留已选组并将未选项切换为单选', () => {
  assert.deepEqual(
    resolveWorkbenchFileSelection(paths, ['/a', '/c'], '/a', '/c', { contextMenu: true }),
    {
      selectedPaths: ['/a', '/c'],
      anchorPath: '/a',
    },
  )
  assert.deepEqual(
    resolveWorkbenchFileSelection(paths, ['/a', '/c'], '/a', '/d', { contextMenu: true }),
    {
      selectedPaths: ['/d'],
      anchorPath: '/d',
    },
  )
})
