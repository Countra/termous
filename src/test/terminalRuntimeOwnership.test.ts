import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const providerSource = readFileSync(
  fileURLToPath(new URL('../features/terminal/runtime/TerminalRuntimeProvider.tsx', import.meta.url)),
  'utf8',
)

test('终端运行时保持单一 Provider 所有权和常驻 parking host', () => {
  assert.match(
    providerSource,
    /<TerminalCwdRuntimeProvider runtime=\{cwdRuntime\}>\s*<TerminalRuntimeContext\.Provider value=\{value\}>\s*\{children\}\s*<div className=\{styles\.parking\} ref=\{parkingHostRef\}/,
  )
})

test('终端会话容器只创建一次并在可见视口与 parking host 之间移动', () => {
  const createEntrySource = sliceBetween(
    providerSource,
    'const createEntry = useCallback(',
    'const moveEntryToHost = useCallback(',
  )
  const viewportSyncSource = sliceBetween(
    providerSource,
    'const moveEntryToHost = useCallback(',
    'const registerViewport = useCallback(',
  )

  assert.match(createEntrySource, /const existingEntry = entriesRef\.current\.get\(sessionId\)[\s\S]*?return existingEntry/)
  assert.equal((createEntrySource.match(/document\.createElement\('div'\)/g) ?? []).length, 1)
  assert.match(createEntrySource, /\(parkingHostRef\.current \?\? document\.body\)\.appendChild\(pane\)/)
  assert.match(createEntrySource, /pane\.dataset\.terminalVisibility = 'inactive'/)
  assert.match(viewportSyncSource, /const targetHost = host \?\? parkingHostRef\.current/)
  assert.match(viewportSyncSource, /targetHost\.appendChild\(entry\.container\)/)
  assert.match(viewportSyncSource, /entry\.container\.dataset\.terminalVisibility = !visible \? 'inactive' : active \? 'active' : 'visible'/)
  assert.doesNotMatch(viewportSyncSource, /classList\.toggle\('is-(?:active|inactive)'/)
  assert.doesNotMatch(viewportSyncSource, /document\.createElement|disposeSession/)
})

test('注销视口只清理视口状态并将会话迁回 parking host', () => {
  const registerViewportSource = sliceBetween(
    providerSource,
    'const registerViewport = useCallback(',
    'const focusActive = useCallback(',
  )

  assert.match(registerViewportSource, /viewportsRef\.current\.delete\(viewportId\)/)
  assert.match(registerViewportSource, /completionRuntime\.closeSuggestions\(current\.sessionId\)/)
  assert.match(registerViewportSource, /syncViewports\(\)/)
  assert.doesNotMatch(registerViewportSource, /disposeSession|entriesRef\.current\.delete/)
})

function sliceBetween(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.notEqual(start, -1, `缺少起始标记：${startMarker}`)
  assert.notEqual(end, -1, `缺少结束标记：${endMarker}`)
  return source.slice(start, end)
}
