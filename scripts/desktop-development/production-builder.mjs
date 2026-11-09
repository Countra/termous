import identities from '../../common/desktop-identity/identities.json' with { type: 'json' }
const { production } = identities

// 构建器与主进程读取同一份身份；更新模拟包通过自己的配置显式覆盖。
export default {
  appId: production.appId,
  productName: production.name,
  executableName: production.executableName,
  extraMetadata: { termousDesktopChannel: 'production', desktopName: production.desktopName },
  // 升级 GUID 保留旧安装身份，不能随新的系统 AppId 重新派生。
  nsis: { shortcutName: production.name, guid: '2d22eb01-e141-5a8b-b280-379650e0df4c' },
  mac: { icon: `${production.iconDirectory}/icon.icns` },
  win: { icon: `${production.iconDirectory}/icon.ico` },
  linux: { icon: `${production.iconDirectory}/icon.png`, syncDesktopName: true },
}
