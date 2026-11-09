import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'

import { hashRegularFile } from './release-manifest-contract.mjs'

const binaries = ['termous-core.exe', 'termous-desktop.exe', 'termous-desktopd.exe']

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key))
}

// 与安装端校验同一配套合同，在生成发布结果前拒绝缺失或混合版本。
export async function validateDesktopBundle(directory, version) {
  const manifestPath = path.join(directory, 'desktop-bundle.json')
  const info = await lstat(manifestPath)
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0 || info.size > 65536) {
    throw new Error('桌面组件配套清单必须是 64KiB 以内的非空普通文件')
  }
  let bundle
  try {
    bundle = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (cause) {
    throw new Error('桌面组件配套清单不是有效 JSON', { cause })
  }
  if (!exactKeys(bundle, ['protocol_version', 'build_version', 'sha256'])
    || bundle.protocol_version !== 2 || bundle.build_version !== version
    || typeof bundle.build_version !== 'string' || bundle.build_version.length > 128
    || !exactKeys(bundle.sha256, binaries)) {
    throw new Error('桌面组件配套清单格式、协议或构建版本不匹配')
  }
  for (const name of binaries) {
    const expected = bundle.sha256[name]
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) {
      throw new Error(`桌面组件摘要格式不正确：${name}`)
    }
    // 复用既有流式摘要实现，不把大型可执行文件整体读入内存。
    const actual = await hashRegularFile(path.join(directory, name))
    if (actual.sha256 !== expected) {
      throw new Error(`桌面组件摘要不匹配，可能混入其他构建产物：${name}`)
    }
  }
}
