import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildBookmarkGroups,
  buildBookmarkReorderItems,
  buildBookmarkStepReorderItems,
  buildGroupReorderItems,
  buildGroupStepReorderItems,
  filterBookmarkGroups,
  findBookmarkForPath,
  flattenBookmarksForRail,
  suggestBookmarkName,
} from '#entities/file'
import type { FileBookmark, FileBookmarkGroup } from '#entities/file'

const groups: FileBookmarkGroup[] = [
  group('group-b', '测试环境', 1),
  group('group-a', '生产环境', 0),
]

const bookmarks: FileBookmark[] = [
  bookmark('logs', '应用日志', '/var/log/app', 'group-a', 1),
  bookmark('releases', '发布目录', '/srv/releases', 'group-a', 0),
  bookmark('tmp', '临时目录', '/tmp', 'missing-group', 0),
  bookmark('sandbox', '沙盒', '/opt/sandbox', 'group-b', 0),
]

test('书签按分组和组内顺序构建，失效分组归入未分组', () => {
  const views = buildBookmarkGroups(groups, bookmarks, '未分组')

  assert.deepEqual(views.map((view) => view.name), ['生产环境', '测试环境', '未分组'])
  assert.deepEqual(views[0]?.items.map((item) => item.id), ['releases', 'logs'])
  assert.deepEqual(views[2]?.items.map((item) => item.id), ['tmp'])
  assert.equal(views[2]?.builtIn, true)
})

test('未分组即使为空也保留为跨组拖动落点', () => {
  const views = buildBookmarkGroups(
    groups,
    bookmarks.filter((item) => item.id !== 'tmp'),
    '未分组',
  )

  const ungrouped = views[views.length - 1]
  assert.equal(ungrouped?.id, '')
  assert.equal(ungrouped?.builtIn, true)
  assert.deepEqual(ungrouped?.items, [])
})

test('搜索同时匹配分组、书签名称和路径', () => {
  const views = buildBookmarkGroups(groups, bookmarks, '未分组')

  assert.deepEqual(
    filterBookmarkGroups(views, '生产').flatMap((view) => view.items.map((item) => item.id)),
    ['releases', 'logs'],
  )
  assert.deepEqual(
    filterBookmarkGroups(views, '日志').flatMap((view) => view.items.map((item) => item.id)),
    ['logs'],
  )
  assert.deepEqual(
    filterBookmarkGroups(views, '/opt').flatMap((view) => view.items.map((item) => item.id)),
    ['sandbox'],
  )
  assert.deepEqual(filterBookmarkGroups(views, '不存在'), [])
})

test('轨道保持分组顺序并标记每个分组的首项', () => {
  const items = flattenBookmarksForRail(groups, bookmarks, '未分组')

  assert.deepEqual(items.map((item) => item.bookmark.id), ['releases', 'logs', 'sandbox', 'tmp'])
  assert.deepEqual(items.map((item) => item.startsGroup), [true, false, true, true])
  assert.deepEqual(items.map((item) => item.groupName), ['生产环境', '生产环境', '测试环境', '未分组'])
})

test('当前路径匹配会规范化远端路径且名称建议取最后一级', () => {
  assert.equal(findBookmarkForPath(bookmarks, '/srv/./releases/')?.id, 'releases')
  assert.equal(findBookmarkForPath(bookmarks, 'relative'), null)
  assert.equal(suggestBookmarkName('/var/log/app/'), 'app')
  assert.equal(suggestBookmarkName('/'), '/')
})

test('书签跨组重排更新目标顺序，搜索锁定时不生成写入', () => {
  assert.deepEqual(buildBookmarkReorderItems(bookmarks, 'tmp', 'group-a', 'logs', false), [])

  const items = buildBookmarkReorderItems(bookmarks, 'tmp', 'group-a', 'logs')
  assert.deepEqual(
    items
      .filter((item) => item.group_id === 'group-a')
      .map((item) => [item.id, item.sort_order]),
    [
      ['releases', 0],
      ['tmp', 1],
      ['logs', 2],
    ],
  )
})

test('书签向下和移到末尾时保持指针方向', () => {
  const items = buildBookmarkReorderItems(
    bookmarks,
    'releases',
    'group-a',
    'logs',
    true,
    'auto',
    groups.map((item) => item.id),
  )
  assert.deepEqual(
    items
      .filter((item) => item.group_id === 'group-a')
      .map((item) => item.id),
    ['logs', 'releases'],
  )
  assert.deepEqual(
    buildBookmarkStepReorderItems(
      bookmarks,
      'releases',
      1,
      groups.map((item) => item.id),
    )
      .filter((item) => item.group_id === 'group-a')
      .map((item) => item.id),
    ['logs', 'releases'],
  )
})

test('书签跨组拖到最后一项下半区时落在目标组末尾', () => {
  const items = buildBookmarkReorderItems(
    bookmarks,
    'sandbox',
    'group-a',
    'logs',
    true,
    'after',
    groups.map((item) => item.id),
  )
  assert.deepEqual(
    items
      .filter((item) => item.group_id === 'group-a')
      .map((item) => item.id),
    ['releases', 'logs', 'sandbox'],
  )
})

test('失效分组中的书签可作为未分组排序落点', () => {
  const items = buildBookmarkReorderItems(
    bookmarks,
    'logs',
    '',
    'tmp',
    true,
    'before',
    groups.map((item) => item.id),
  )
  assert.deepEqual(
    items
      .filter((item) => item.group_id === '')
      .map((item) => item.id),
    ['logs', 'tmp'],
  )
})

test('分组重排遵守现有排序，搜索锁定时保持只读', () => {
  assert.deepEqual(buildGroupReorderItems(groups, 'group-b', 'group-a', false), [])
  assert.deepEqual(buildGroupReorderItems(groups, 'group-b', 'group-a'), [
    { id: 'group-b', sort_order: 0 },
    { id: 'group-a', sort_order: 1 },
  ])
  assert.deepEqual(buildGroupReorderItems(groups, 'group-a', 'group-b'), [
    { id: 'group-b', sort_order: 0 },
    { id: 'group-a', sort_order: 1 },
  ])
  assert.deepEqual(buildGroupStepReorderItems(groups, 'group-a', 1), [
    { id: 'group-b', sort_order: 0 },
    { id: 'group-a', sort_order: 1 },
  ])
})

test('键盘步进在首尾保持 no-op，并支持向上移动', () => {
  assert.deepEqual(
    buildBookmarkStepReorderItems(
      bookmarks,
      'releases',
      -1,
      groups.map((item) => item.id),
    ),
    [],
  )
  assert.deepEqual(
    buildBookmarkStepReorderItems(
      bookmarks,
      'logs',
      -1,
      groups.map((item) => item.id),
    )
      .filter((item) => item.group_id === 'group-a')
      .map((item) => item.id),
    ['logs', 'releases'],
  )
  assert.deepEqual(buildGroupStepReorderItems(groups, 'group-a', -1), [])
  assert.deepEqual(buildGroupStepReorderItems(groups, 'group-b', 1), [])
  assert.deepEqual(buildGroupStepReorderItems(groups, 'group-b', -1), [
    { id: 'group-b', sort_order: 0 },
    { id: 'group-a', sort_order: 1 },
  ])
})

function group(id: string, name: string, sortOrder: number): FileBookmarkGroup {
  return {
    id,
    name,
    sort_order: sortOrder,
    created_at: '2026-07-24T00:00:00Z',
    updated_at: '2026-07-24T00:00:00Z',
  }
}

function bookmark(
  id: string,
  name: string,
  path: string,
  groupId: string,
  sortOrder: number,
): FileBookmark {
  return {
    id,
    name,
    path,
    group_id: groupId,
    sort_order: sortOrder,
    created_at: '2026-07-24T00:00:00Z',
    updated_at: '2026-07-24T00:00:00Z',
  }
}
