import assert from 'node:assert/strict'
import test from 'node:test'
import {
  closeUnterminatedUpdateReleaseNotesFence,
  normalizeUpdateReleaseNotesText,
  updateReleaseNotesRawInputLimit,
} from './updateReleaseNotes.ts'

test('更新说明净化时保留标题、段落和列表结构', () => {
  const result = normalizeUpdateReleaseNotesText(
    '<h2><strong>Termous 0.3.0</strong></h2><p>稳定性更新</p><h3>Fixed</h3><ul><li>连接恢复</li><li>支持 <code>.tobp</code></li></ul><ol><li>下载</li><li>安装</li></ol>',
    4_000,
  )

  assert.equal(
    result,
    '## **Termous 0.3.0**\n\n稳定性更新\n\n### Fixed\n\n- 连接恢复\n- 支持 `.tobp`\n\n1. 下载\n2. 安装',
  )
})

test('更新说明净化会移除危险标记和控制字符', () => {
  const result = normalizeUpdateReleaseNotesText(
    '<script>steal()</script><iframe>bad</iframe>### 安全\u0000\n\n- 保留',
    4_000,
  )

  assert.equal(result, '### 安全\n\n- 保留')
})

test('更新说明净化保持长度上限', () => {
  assert.equal(
    normalizeUpdateReleaseNotesText('123456', 5),
    '1234…',
  )
})

test('更新说明重复净化时保留行内代码中的尖括号', () => {
  const once = normalizeUpdateReleaseNotesText(
    '<p>使用 <code>&lt;host&gt;</code> 连接</p>',
    4_000,
  )

  assert.equal(once, '使用 `<host>` 连接')
  assert.equal(
    normalizeUpdateReleaseNotesText(once, 4_000),
    once,
  )
})

test('更新说明重复净化时不会改写代码中的已识别标签', () => {
  const once = normalizeUpdateReleaseNotesText(
    '<p><code>&lt;strong&gt;x&lt;/strong&gt;</code></p>',
    4_000,
  )

  assert.equal(once, '`<strong>x</strong>`')
  assert.equal(
    normalizeUpdateReleaseNotesText(once, 4_000),
    once,
  )
})

test('更新说明截断时保留行内代码闭合并维持重复净化一致', () => {
  const source = `\`<strong>x</strong>${'a'.repeat(3_985)}\``
  const once = normalizeUpdateReleaseNotesText(source, 4_000)

  assert.equal(once?.includes('<strong>x</strong>'), true)
  assert.equal(once?.endsWith('`…'), true)
  assert.equal(
    normalizeUpdateReleaseNotesText(once, 4_000),
    once,
  )
})

test('密集行内代码片段保持有界处理和重复净化一致', () => {
  const source = '`a`'.repeat(2_500)
  const once = normalizeUpdateReleaseNotesText(source, 4_000)

  assert.equal(Array.from(once ?? '').length <= 4_000, true)
  assert.equal(
    normalizeUpdateReleaseNotesText(once, 4_000),
    once,
  )
})

test('更新说明保留围栏代码的缩进和标签文本', () => {
  const notes = [
    '### 配置',
    '',
    '```yaml',
    'services:',
    '  api:',
    '    image: <registry>/app',
    '    command: <script>keep-as-code()</script>',
    '```',
  ].join('\n')

  assert.equal(
    normalizeUpdateReleaseNotesText(notes, 4_000),
    notes,
  )
})

test('HTML 换行会保留为明确的段落边界', () => {
  assert.equal(
    normalizeUpdateReleaseNotesText(
      '<p>第一行<br>第二行</p>',
      4_000,
    ),
    '第一行\n\n第二行',
  )
})

test('数组项隔离时会在长度预算内闭合围栏代码', () => {
  const isolated = closeUnterminatedUpdateReleaseNotesFence(
    `\`\`\`text\n${'a'.repeat(20)}`,
    16,
  )

  assert.equal(Array.from(isolated).length <= 16, true)
  assert.equal(isolated.endsWith('\n```'), true)
})

test('更新说明按完整 Unicode 字符截断', () => {
  const result = normalizeUpdateReleaseNotesText(
    `${'a'.repeat(3_998)}😀xy`,
    4_000,
  )

  assert.equal(Array.from(result ?? '').length, 4_000)
  assert.equal(result?.endsWith('😀…'), true)
})

test('更新说明截断时保留完整的 Unicode 字素簇', () => {
  const family = '👨‍👩‍👧‍👦'
  const result = normalizeUpdateReleaseNotesText(
    `${'a'.repeat(3_992)}${family}xy`,
    4_000,
  )

  assert.equal(Array.from(result ?? '').length, 4_000)
  assert.equal(result?.endsWith(`${family}…`), true)
})

test('更新说明在格式化前限制异常长的原始输入', () => {
  const result = normalizeUpdateReleaseNotesText(
    `保留${' '.repeat(updateReleaseNotesRawInputLimit)}不应读取`,
    4_000,
  )

  assert.equal(result, '保留')
})

test('原始输入限制不会保留被边界截断的字素簇', () => {
  const result = normalizeUpdateReleaseNotesText(
    `前缀${' '.repeat(updateReleaseNotesRawInputLimit - 2)}👨‍👩‍👧‍👦末尾`,
    4_000,
  )

  assert.equal(result, '前缀')
})
