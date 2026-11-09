import assert from 'node:assert/strict'
import test from 'node:test'
import { integrationEnvironment } from './environment.ts'

test('Windows 宿主两次过滤后仍保留浏览器安装路径及包缓存目录', () => {
  const source = { Path: 'C:\\node', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
    USERPROFILE: 'C:\\Users\\test', SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\System32\\cmd.exe', PATHEXT: '.EXE;.CMD' }
  const host = integrationEnvironment(source, {}, 'win32')
  assert.deepEqual(integrationEnvironment(host, {}, 'win32'), host)
  assert.equal(host.PROGRAMFILES, source.ProgramFiles)
  assert.equal(host['PROGRAMFILES(X86)'], source['ProgramFiles(x86)'])
  assert.equal(host.LOCALAPPDATA, source.LOCALAPPDATA)
  assert.equal(host.APPDATA, source.APPDATA)
  assert.equal(host.USERPROFILE, source.USERPROFILE)
  assert.equal(host.SYSTEMROOT, source.SystemRoot)
  assert.equal(host.COMSPEC, source.ComSpec)
  assert.equal(host.PATHEXT, source.PATHEXT)
})

test('外部进程不继承宿主秘密、代理或代码注入环境', () => {
  const source = { PATH: '/bin', HOME: '/home/test', TEMP: '/tmp', TERMOUS_API_TOKEN: 'private',
    OPENAI_API_KEY: 'private', NODE_OPTIONS: '--import=untrusted', ELECTRON_RUN_AS_NODE: '1',
    PYTHONPATH: '/untrusted', HTTPS_PROXY: 'http://private', AWS_SECRET_ACCESS_KEY: 'private', EMPTY: undefined }
  for (const platform of ['win32', 'linux', 'darwin'] as const) {
    assert.deepEqual(integrationEnvironment(source, {}, platform), { PATH: '/bin', HOME: '/home/test', TEMP: '/tmp' })
  }
})

test('用户显式环境覆盖 Windows 大小写别名且不修改原对象', () => {
  const source = { Path: 'original', SystemRoot: 'system' }
  const configured = { path: 'configured', systemroot: 'custom', SERVICE_TOKEN: 'explicit' }
  assert.deepEqual(integrationEnvironment(source, configured, 'win32'), {
    PATH: 'configured', SYSTEMROOT: 'custom', SERVICE_TOKEN: 'explicit',
  })
  assert.equal(source.Path, 'original')
  assert.equal(configured.path, 'configured')
})

test('POSIX 保留环境变量大小写语义且不继承 Windows 专用路径', () => {
  assert.deepEqual(integrationEnvironment({ PATH: '/bin', Path: '/ignored', HOME: '/home/test', ProgramFiles: '/ignored' },
    { Path: '/explicit' }, 'linux'), { PATH: '/bin', HOME: '/home/test', Path: '/explicit' })
})
