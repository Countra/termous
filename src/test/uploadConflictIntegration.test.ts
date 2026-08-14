import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

function readSource(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

function sourceSection(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`)
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

const workbenchSource = readSource('../features/workbench-files/ui/WorkbenchFilesPanel.tsx')
const workspaceSource = readSource('../widgets/files-workspace/ui/FilesWorkspace.tsx')

const workbenchUploadSource = sourceSection(
  workbenchSource,
  '  const uploadPaths = async',
  '  const downloadPaths = async',
)
const workspaceUploadSource = sourceSection(
  workspaceSource,
  '  const uploadLocalPaths = async',
  '  const downloadPathsToLocalDir = async',
)

function assertSharedUploadConflictFlow(
  source: string,
) {
  assert.match(source, /await createUploadWithConflictDecision\(\{/)
  assert.match(source, /createGrant:\s*api\.createLocalFileGrant/)
  assert.match(source, /releaseGrant:\s*api\.releaseLocalFileGrant/)
  assert.match(source, /requestPolicy:\s*uploadConflictDecision\.requestPolicy/)
  assert.match(source, /isCurrent:\s*isCurrentUploadSession/)
  assert.match(
    source,
    /createFileSessionUploadTransfer\(\s*fileSessionId,\s*grantId,\s*remoteDir,\s*['"]rename['"],\s*overwriteItemIds,?\s*\)/,
  )
}

test('工作台文件上传使用共享冲突流程并仅提交确认过的覆盖项', () => {
  assert.match(
    workbenchSource,
    /import\s*\{[\s\S]*?createUploadWithConflictDecision[\s\S]*?UploadConflictDialog[\s\S]*?useUploadConflictDecision[\s\S]*?\}\s*from '#features\/transfers'/,
  )
  assert.match(
    workbenchSource,
    /<UploadConflictDialog\s+\{\.\.\.uploadConflictDecision\.dialogProps\}\s*\/>/,
  )
  assertSharedUploadConflictFlow(workbenchUploadSource)
})

test('完整文件工作区使用共享冲突流程并仅提交确认过的覆盖项', () => {
  assert.match(
    workspaceSource,
    /import\s*\{[\s\S]*?createUploadWithConflictDecision[\s\S]*?UploadConflictDialog[\s\S]*?useUploadConflictDecision[\s\S]*?\}\s*from '#features\/transfers'/,
  )
  assert.match(
    workspaceSource,
    /<UploadConflictDialog\s+\{\.\.\.uploadConflictDecision\.dialogProps\}\s*\/>/,
  )
  assert.match(
    workspaceUploadSource,
    /activeFileSessionIdRef\.current\s*===\s*fileSessionId/,
  )
  assertSharedUploadConflictFlow(workspaceUploadSource)
})
