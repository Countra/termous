import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import identities from '../../common/desktop-identity/identities.json' with { type: 'json' }

const require = createRequire(import.meta.url)

export async function buildDevelopmentShell(webRoot, stage, version) {
  const identity = identities.development
  const { build, Platform, Arch } = require('electron-builder')
  const platform = { win32: Platform.WINDOWS, darwin: Platform.MAC, linux: Platform.LINUX }[process.platform]
  if (!platform) throw new Error('当前平台不支持桌面开发壳')
  await build({ projectDir: path.join(stage, 'app'), targets: platform.createTarget(['dir'], Arch[process.arch]), publish: 'never', config: {
    extends: null, appId: identity.appId, productName: identity.name, executableName: identity.executableName,
    electronVersion: version, electronDist: path.join(path.dirname(require.resolve('electron/package.json')), 'dist'), asar: false,
    npmRebuild: false, nodeGypRebuild: false,
    directories: { app: path.join(stage, 'app'), output: path.join(stage, 'output'), buildResources: path.join(webRoot, identity.iconDirectory) },
    files: ['package.json', 'bootstrap.mjs'], extraResources: [{ from: path.join(webRoot, identity.iconDirectory, 'icon.png'), to: 'icon.png' }],
    win: { icon: path.join(webRoot, identity.iconDirectory, 'icon.ico') },
    mac: { icon: path.join(webRoot, identity.iconDirectory, 'icon.icns'), identity: null, notarize: false },
    linux: { icon: path.join(webRoot, identity.iconDirectory, 'icon.png'), syncDesktopName: true },
  } })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await buildDevelopmentShell(...process.argv.slice(2)) }
  catch (error) { console.error(error); process.exit(1) }
}
