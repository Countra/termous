import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseUpdateReleaseNotes,
  resolveUpdateReleaseNotesContent,
  tokenizeUpdateReleaseNoteInline,
} from '../features/update/updateReleaseNotes.ts'

test('更新说明按标题、段落和列表解析', () => {
  const blocks = parseUpdateReleaseNotes([
    '## [0.3.0] - 2026-07-26',
    '',
    '### Added',
    '',
    '- 新增 **应用内更新**',
    '- 支持 `SFTP` 恢复',
    '',
    '1. 下载',
    '2. 安装',
    '',
    '更新过程保持当前工作状态。',
  ].join('\n'))

  assert.deepEqual(blocks, [
    {
      type: 'heading',
      level: 2,
      text: '[0.3.0] - 2026-07-26',
    },
    {
      type: 'heading',
      level: 3,
      text: 'Added',
    },
    {
      type: 'unordered-list',
      items: ['新增 **应用内更新**', '支持 `SFTP` 恢复'],
    },
    {
      type: 'ordered-list',
      items: ['下载', '安装'],
    },
    {
      type: 'paragraph',
      text: '更新过程保持当前工作状态。',
    },
  ])
})

test('更新说明行内格式仅解析粗体和代码文本', () => {
  assert.deepEqual(
    tokenizeUpdateReleaseNoteInline('修复 **连接恢复** 与 `cwd` 状态'),
    [
      { type: 'text', text: '修复 ' },
      { type: 'strong', text: '连接恢复' },
      { type: 'text', text: ' 与 ' },
      { type: 'code', text: 'cwd' },
      { type: 'text', text: ' 状态' },
    ],
  )
})

test('空更新说明不会生成内容块', () => {
  assert.deepEqual(parseUpdateReleaseNotes(' \n '), [])
})

test('空白更新说明会回退到默认文案', () => {
  assert.equal(
    resolveUpdateReleaseNotesContent(' \n ', '暂无更新说明'),
    '暂无更新说明',
  )
  assert.equal(
    resolveUpdateReleaseNotesContent('修复连接', '暂无更新说明'),
    '修复连接',
  )
})

test('标题末尾的井号只有在空白分隔时才作为闭合标记', () => {
  assert.deepEqual(
    parseUpdateReleaseNotes('### C#\n\n### 已完成 ###'),
    [
      {
        type: 'heading',
        level: 3,
        text: 'C#',
      },
      {
        type: 'heading',
        level: 3,
        text: '已完成',
      },
    ],
  )
})
