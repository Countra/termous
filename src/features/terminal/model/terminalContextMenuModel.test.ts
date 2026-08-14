import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildTerminalContextMenu,
  type TerminalContextMenuItem,
} from './terminalContextMenuModel.ts'
import type { TerminalContextSnapshot } from './terminalContextTarget.ts'

test('普通选区按复制、查找、粘贴、清屏和全选排序', () => {
  assert.deepEqual(keys(buildTerminalContextMenu(snapshot({
    selectionText: 'needle',
    searchSeed: 'needle',
  }))), [
    'copy_selection',
    'find_selection',
    'paste',
    '|',
    'clear',
    'select_all',
  ])
})

test('超长或多行选区降级为打开普通查找', () => {
  assert.deepEqual(keys(buildTerminalContextMenu(snapshot({
    selectionText: 'one\ntwo',
    searchSeed: '',
  }))), [
    'copy_selection',
    'find',
    'paste',
    '|',
    'clear',
    'select_all',
  ])
})

test('空白区域按粘贴、清屏、全选和查找排序', () => {
  assert.deepEqual(keys(buildTerminalContextMenu(snapshot())), [
    'paste',
    'clear',
    'select_all',
    'find',
  ])
})

test('URL 与路径使用专用动作且不重复复制动作', () => {
  assert.deepEqual(keys(buildTerminalContextMenu(snapshot({
    selectionText: 'https://example.com',
    target: {
      kind: 'url',
      source: 'selection',
      value: 'https://example.com',
    },
  }))), [
    'open_link',
    'copy_link',
    '|',
    'paste',
    'clear',
    'select_all',
    'find',
  ])
  assert.deepEqual(keys(buildTerminalContextMenu(snapshot({
    target: {
      kind: 'path',
      source: 'pointer',
      value: '/var/log',
      resolution: 'absolute',
      requiresCwd: false,
      copyOnly: false,
    },
  }), { canOpenPath: true })), [
    'open_path',
    'copy_path',
    '|',
    'paste',
    'clear',
    'select_all',
    'find',
  ])
})

test('HOME 相对路径只保留复制，缺少可信目录时禁用打开路径', () => {
  const homeItems = buildTerminalContextMenu(snapshot({
    target: {
      kind: 'path',
      source: 'pointer',
      value: '~/downloads',
      resolution: 'home_relative',
      requiresCwd: false,
      copyOnly: true,
    },
  }))
  assert.equal(actionItem(homeItems, 'open_path'), undefined)

  const relativeItems = buildTerminalContextMenu(snapshot({
    target: {
      kind: 'path',
      source: 'pointer',
      value: '../logs',
      resolution: 'cwd_relative',
      requiresCwd: true,
      copyOnly: false,
    },
  }), { canOpenPath: false })
  assert.equal(actionItem(relativeItems, 'open_path')?.disabled, true)
})

test('本地终端路径不展示远程文件管理动作', () => {
  const items = buildTerminalContextMenu(snapshot({
    target: {
      kind: 'path',
      source: 'pointer',
      value: '/var/log',
      resolution: 'absolute',
      requiresCwd: false,
      copyOnly: false,
    },
  }), {
    canOpenPath: false,
    showOpenPath: false,
  })
  assert.deepEqual(keys(items), [
    'copy_path',
    '|',
    'paste',
    'clear',
    'select_all',
    'find',
  ])
})

test('断线重连始终置顶、禁用粘贴并保留本地清屏', () => {
  const items = buildTerminalContextMenu(snapshot({
    disconnected: true,
    writable: false,
    selectionText: 'copy me',
    searchSeed: 'copy me',
  }))
  assert.deepEqual(keys(items).slice(0, 2), ['reconnect', '|'])
  assert.equal(actionItem(items, 'paste')?.disabled, true)
  assert.equal(actionItem(items, 'clear')?.disabled, false)
})

function snapshot(overrides: Partial<TerminalContextSnapshot> = {}): TerminalContextSnapshot {
  return {
    sessionId: 'session-1',
    selectionText: '',
    searchSeed: '',
    target: null,
    mouseTrackingMode: 'none',
    writable: true,
    disconnected: false,
    ...overrides,
  }
}

function keys(items: TerminalContextMenuItem[]) {
  return items.map((item) => item.type === 'separator' ? '|' : item.key)
}

function actionItem(items: TerminalContextMenuItem[], key: string) {
  return items.find(
    (item): item is Extract<TerminalContextMenuItem, { type: 'action' }> => (
      item.type === 'action' && item.key === key
    ),
  )
}
