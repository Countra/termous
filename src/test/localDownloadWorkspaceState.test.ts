import assert from 'node:assert/strict'
import test from 'node:test'
import type { LocalPathMapping, LocalTreeEntry } from '../types/domain.ts'
import {
  beginLocalDirectoryRequest,
  cancelLocalDirectoryRequest,
  completeLocalDirectoryRequest,
  createLocalDirectoryViewState,
  failLocalDirectoryRequest,
  isLocalPathWithin,
  isSafeLocalDownloadTarget,
  localPathBreadcrumbs,
  localPathParent,
  resolveLocalDownloadQuickTarget,
  resolveLocalDownloadRefreshMapping,
  resolveLocalDownloadSelectedMapping,
} from '../features/files/local-download/localDownloadWorkspaceState.ts'

function mapping(
  id = 'mapping-1',
  path = 'C:\\Users\\termous\\Downloads',
): LocalPathMapping {
  return {
    id,
    name: id,
    path,
    sort_order: 0,
    available: true,
    created_at: '2026-07-24T00:00:00Z',
    updated_at: '2026-07-24T00:00:00Z',
  }
}

function directory(path: string, overrides: Partial<LocalTreeEntry> = {}): LocalTreeEntry {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return {
    name: parts[parts.length - 1] ?? path,
    path,
    kind: 'directory',
    size: 0,
    has_children: false,
    is_accessible: true,
    ...overrides,
  }
}

test('目录状态只允许最新请求提交并保留导航失败前的列表', () => {
  const root = mapping()
  const initial = createLocalDirectoryViewState(root)
  const load = beginLocalDirectoryRequest(initial, root.path, 'load')
  const loaded = completeLocalDirectoryRequest(
    load.state,
    load.requestSequence,
    root.path,
    [directory(`${root.path}\\one`)],
  )
  const first = beginLocalDirectoryRequest(loaded, `${root.path}\\one`, 'navigate')
  const second = beginLocalDirectoryRequest(first.state, `${root.path}\\two`, 'navigate')

  const late = completeLocalDirectoryRequest(
    second.state,
    first.requestSequence,
    first.path,
    [directory(`${first.path}\\late`)],
  )
  assert.equal(late, second.state)

  const failed = failLocalDirectoryRequest(
    second.state,
    second.requestSequence,
    second.path,
    second.kind,
    '拒绝访问',
  )
  assert.equal(failed.committedPath, root.path)
  assert.equal(failed.entries[0]?.path, `${root.path}\\one`)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.retry?.path, second.path)
})

test('取消请求递增 sequence，迟到响应无法覆盖已提交目录', () => {
  const root = mapping()
  const initial = createLocalDirectoryViewState(root)
  const request = beginLocalDirectoryRequest(initial, `${root.path}\\one`, 'navigate')
  const canceled = cancelLocalDirectoryRequest(request.state)
  const late = completeLocalDirectoryRequest(
    canceled,
    request.requestSequence,
    request.path,
    [],
  )

  assert.equal(canceled.requestSequence, request.requestSequence + 1)
  assert.equal(canceled.pendingPath, null)
  assert.equal(late, canceled)
})

test('目录列表排除文件、符号链接和不可访问目录', () => {
  const root = mapping()
  const request = beginLocalDirectoryRequest(createLocalDirectoryViewState(root), root.path, 'load')
  const completed = completeLocalDirectoryRequest(
    request.state,
    request.requestSequence,
    request.path,
    [
      directory(`${root.path}\\zeta`),
      directory(`${root.path}\\alpha`),
      directory(`${root.path}\\blocked`, { is_accessible: false }),
      directory(`${root.path}\\linked`, { kind: 'symlink' }),
      directory(`${root.path}\\file.txt`, { kind: 'file' }),
    ],
  )

  assert.deepEqual(completed.entries.map((entry) => entry.name), ['alpha', 'zeta'])
})

test('路径边界按目录段判断并兼容 Windows 大小写', () => {
  assert.equal(isLocalPathWithin('C:\\Users\\Termous\\Downloads\\jobs', 'c:\\users\\termous\\downloads'), true)
  assert.equal(isLocalPathWithin('C:\\Users\\Termous\\Downloads-old', 'c:\\users\\termous\\downloads'), false)
  assert.equal(isLocalPathWithin('/home/termous/downloads/jobs', '/home/termous/downloads'), true)
  assert.equal(isLocalPathWithin('/home/termous/downloads-old', '/home/termous/downloads'), false)
  assert.equal(isLocalPathWithin('/Home/termous/downloads', '/home/termous/downloads'), false)
})

test('面包屑和上级目录不会越过映射根目录', () => {
  const root = mapping()
  const current = `${root.path}\\projects\\release`
  const breadcrumbs = localPathBreadcrumbs(root, current)

  assert.deepEqual(breadcrumbs.map((item) => item.label), [root.name, 'projects', 'release'])
  assert.equal(localPathParent(current, root.path), `${root.path}\\projects`)
  assert.equal(localPathParent(root.path, root.path), root.path)
  assert.equal(localPathParent('C:\\Windows', root.path), root.path)
})

test('下载目标必须是映射根内的真实可访问目录', () => {
  const root = mapping()
  assert.equal(
    isSafeLocalDownloadTarget(root, `${root.path}\\jobs`, directory(`${root.path}\\jobs`)),
    true,
  )
  assert.equal(
    isSafeLocalDownloadTarget(root, `${root.path}\\jobs`, directory('C:\\Windows')),
    false,
  )
  assert.equal(
    isSafeLocalDownloadTarget(
      root,
      `${root.path}\\linked`,
      directory(`${root.path}\\linked`, { kind: 'symlink' }),
    ),
    false,
  )
})

test('刷新请求带 mappingId 时不会误命中重叠映射', () => {
  const parent = mapping('parent', 'C:\\Downloads')
  const nested = mapping('nested', 'C:\\Downloads\\projects')
  const targetPath = 'C:\\Downloads\\projects\\release'

  assert.equal(
    resolveLocalDownloadRefreshMapping([parent, nested], { targetPath })?.id,
    'nested',
  )
  assert.equal(
    resolveLocalDownloadRefreshMapping(
      [parent, nested],
      { mappingId: 'parent', targetPath },
    )?.id,
    'parent',
  )
  assert.equal(
    resolveLocalDownloadRefreshMapping(
      [parent, nested],
      { mappingId: 'missing', targetPath },
    ),
    null,
  )
})

test('不可用映射仍可作为管理选中项，但默认下载目标优先可用映射', () => {
  const unavailable = { ...mapping('offline'), available: false }
  const available = mapping('ready')

  assert.equal(
    resolveLocalDownloadSelectedMapping([unavailable, available], '', undefined)?.id,
    'ready',
  )
  assert.equal(
    resolveLocalDownloadSelectedMapping([unavailable, available], 'offline', undefined)?.id,
    'offline',
  )
  assert.equal(
    resolveLocalDownloadSelectedMapping([unavailable], '', undefined)?.id,
    'offline',
  )
  assert.equal(
    resolveLocalDownloadSelectedMapping([available, unavailable], 'ready', 'offline')?.id,
    'offline',
  )
})

test('状态栏默认使用排序首项并保留合法的用户目标', () => {
  const first = {
    ...mapping('first', 'D:\\Downloads'),
    name: '第一个目录',
    available: false,
  }
  const second = {
    ...mapping('second', 'D:\\Workspace'),
    name: '工作目录',
  }

  assert.equal(resolveLocalDownloadQuickTarget([], null), null)
  assert.deepEqual(resolveLocalDownloadQuickTarget([first, second], null), {
    mappingId: 'first',
    mappingName: '第一个目录',
    mappingPath: 'D:\\Downloads',
    path: 'D:\\Downloads',
    available: false,
  })
  assert.deepEqual(resolveLocalDownloadQuickTarget([first, second], {
    mappingId: 'second',
    mappingName: '旧名称',
    mappingPath: 'D:\\Workspace',
    path: 'D:\\Workspace\\release',
    available: false,
  }), {
    mappingId: 'second',
    mappingName: '工作目录',
    mappingPath: 'D:\\Workspace',
    path: 'D:\\Workspace\\release',
    available: true,
  })
  assert.equal(
    resolveLocalDownloadQuickTarget([first, second], {
      mappingId: 'second',
      mappingName: '工作目录',
      mappingPath: 'D:\\OldWorkspace',
      path: 'D:\\OldWorkspace\\release',
      available: true,
    })?.path,
    'D:\\Workspace',
  )
  assert.equal(
    resolveLocalDownloadQuickTarget([first], {
      mappingId: 'second',
      mappingName: '工作目录',
      mappingPath: 'D:\\Workspace',
      path: 'D:\\Workspace\\release',
      available: true,
    })?.mappingId,
    'first',
  )
})
