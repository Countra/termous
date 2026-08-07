import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canAddTerminalPane,
  compactTerminalSplitLayout,
  countTerminalPanes,
  createDropSessionOrder,
  createPresetTerminalLayout,
  findTerminalPaneBySession,
  getTerminalPaneLeaves,
  getTerminalSplitPreset,
  moveTerminalSessionToPane,
  replaceTerminalPaneSession,
  TERMINAL_SPLIT_MAX_PANES,
  terminalSplitPresets,
  updateTerminalSplitBranchSizes,
  type TerminalSplitBranch,
  type TerminalSplitNode,
  type TerminalSplitPresetId,
} from './terminalSplitLayout.ts'

const sessionIds = ['session-0', 'session-1', 'session-2', 'session-3']

test('终端分屏预设保持固定拓扑并按面板编号分配会话', () => {
  const expectedShapes: Record<TerminalSplitPresetId, string> = {
    'two-columns': 'horizontal[50,50](leaf,leaf)',
    'two-rows': 'vertical[50,50](leaf,leaf)',
    'main-left': 'horizontal[66,34](leaf,leaf)',
    'main-right': 'horizontal[34,66](leaf,leaf)',
    'three-columns': 'horizontal[33.33,33.34,33.33](leaf,leaf,leaf)',
    'left-main-right-stack': 'horizontal[66,34](leaf,vertical[50,50](leaf,leaf))',
    'right-main-left-stack': 'horizontal[34,66](vertical[50,50](leaf,leaf),leaf)',
    'grid-2x2': 'horizontal[50,50](vertical[50,50](leaf,leaf),vertical[50,50](leaf,leaf))',
    focus: 'leaf',
  }

  for (const preset of terminalSplitPresets) {
    const layout = createPresetTerminalLayout(preset.id, sessionIds)
    assert.ok(layout.root)
    assert.equal(preset.paneCount, preset.zones.length)
    assert.equal(countTerminalPanes(layout.root), preset.paneCount)
    assert.equal(describeNode(layout.root), expectedShapes[preset.id])
    assert.equal(layout.activePaneId, 'terminal-pane-0')

    for (let index = 0; index < preset.paneCount; index += 1) {
      assert.equal(
        findTerminalPaneBySession(layout.root, sessionIds[index])?.id,
        `terminal-pane-${index}`,
      )
    }
  }
})

test('替换与移动会话只更新目标面板且不修改原布局', () => {
  const layout = createPresetTerminalLayout('two-columns', ['session-a', 'session-b'])
  assert.ok(layout.root)

  const replaced = replaceTerminalPaneSession(layout.root, 'terminal-pane-1', 'session-c')
  assert.deepEqual(paneSessions(replaced), ['session-a', 'session-c'])

  const moved = moveTerminalSessionToPane(replaced, 'terminal-pane-1', 'session-a')
  assert.deepEqual(paneSessions(moved), [null, 'session-a'])
  assert.deepEqual(paneSessions(layout.root), ['session-a', 'session-b'])
})

test('删除会话后递归折叠空分支并回退活动面板', () => {
  const layout = {
    ...createPresetTerminalLayout('grid-2x2', ['session-a', 'session-b', 'session-c', 'session-d']),
    activePaneId: 'terminal-pane-1',
  }

  const compacted = compactTerminalSplitLayout(layout, ['session-a', 'session-d'])
  assert.ok(compacted.root)
  assert.deepEqual(getTerminalPaneLeaves(compacted.root).map((leaf) => leaf.id), [
    'terminal-pane-0',
    'terminal-pane-3',
  ])
  assert.deepEqual(paneSessions(compacted.root), ['session-a', 'session-d'])
  assert.equal(describeNode(compacted.root), 'horizontal[50,50](leaf,leaf)')
  assert.equal(compacted.activePaneId, 'terminal-pane-0')

  const single = compactTerminalSplitLayout(compacted, ['session-d'])
  assert.equal(single.root?.type, 'leaf')
  assert.equal(single.root?.id, 'terminal-pane-3')
  assert.equal(single.activePaneId, 'terminal-pane-3')

  const empty = compactTerminalSplitLayout(single, [])
  assert.equal(empty.root, null)
  assert.equal(empty.activePaneId, null)
})

test('保留空面板时只清除失效会话并维持预设拓扑', () => {
  const layout = createPresetTerminalLayout('grid-2x2', [
    'session-a',
    'session-b',
    'session-c',
    'session-d',
  ])
  const compacted = compactTerminalSplitLayout(layout, ['session-a', 'session-d'], {
    preserveEmptyPanes: true,
  })

  assert.ok(compacted.root)
  assert.equal(countTerminalPanes(compacted.root), 4)
  assert.equal(
    describeNode(compacted.root),
    'horizontal[50,50](vertical[50,50](leaf,leaf),vertical[50,50](leaf,leaf))',
  )
  assert.deepEqual(sessionByPaneId(compacted.root), {
    'terminal-pane-0': 'session-a',
    'terminal-pane-1': null,
    'terminal-pane-2': null,
    'terminal-pane-3': 'session-d',
  })
})

test('分支尺寸按目标子节点数量归一化且不影响其他分支', () => {
  const layout = createPresetTerminalLayout('grid-2x2', sessionIds)
  assert.ok(layout.root)

  const updated = updateTerminalSplitBranchSizes(layout.root, 'terminal-split-left-grid', [1, 3])
  assert.deepEqual(findBranch(updated, 'terminal-split-left-grid')?.sizes, [25, 75])
  assert.deepEqual(findBranch(updated, 'terminal-split-right-grid')?.sizes, [50, 50])
  assert.deepEqual(findBranch(layout.root, 'terminal-split-left-grid')?.sizes, [50, 50])

  const reset = updateTerminalSplitBranchSizes(updated, 'terminal-split-left-grid', [0, 0])
  assert.deepEqual(findBranch(reset, 'terminal-split-left-grid')?.sizes, [50, 50])
})

test('终端分屏严格限制为四个面板', () => {
  const threePanes = createPresetTerminalLayout('three-columns', sessionIds)
  const fourPanes = createPresetTerminalLayout('grid-2x2', sessionIds)

  assert.equal(TERMINAL_SPLIT_MAX_PANES, 4)
  assert.equal(canAddTerminalPane(threePanes), true)
  assert.equal(canAddTerminalPane(fourPanes), false)
})

test('拖放会话占据目标区域并按原顺序补齐其余区域', () => {
  const layout = createPresetTerminalLayout('three-columns', [
    'session-a',
    'session-b',
    'session-c',
  ])
  const preset = getTerminalSplitPreset('three-columns')
  assert.ok(preset)

  assert.deepEqual(
    createDropSessionOrder(layout, 'session-a', 'right', preset),
    ['session-b', 'session-c', 'session-a'],
  )
})

function describeNode(node: TerminalSplitNode): string {
  if (node.type === 'leaf') {
    return 'leaf'
  }
  return `${node.direction}[${node.sizes.join(',')}](${node.children.map(describeNode).join(',')})`
}

function paneSessions(node: TerminalSplitNode) {
  return getTerminalPaneLeaves(node).map((leaf) => leaf.sessionId)
}

function sessionByPaneId(node: TerminalSplitNode) {
  return Object.fromEntries(
    getTerminalPaneLeaves(node).map((leaf) => [leaf.id, leaf.sessionId]),
  )
}

function findBranch(node: TerminalSplitNode, branchId: string): TerminalSplitBranch | null {
  if (node.type === 'leaf') {
    return null
  }
  if (node.id === branchId) {
    return node
  }
  for (const child of node.children) {
    const branch = findBranch(child, branchId)
    if (branch) {
      return branch
    }
  }
  return null
}
