import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'

// 外部产物只能写入工具链明确拥有的目录；普通开发仍使用原有布局。
export function buildOutputPaths(webDirectory, env = process.env) {
  const configured = env.TERMOUS_BUILD_OUTPUT_DIR
  if (!configured) {
    return {
      renderer: path.join(webDirectory, 'dist'),
      electron: path.join(webDirectory, 'dist-electron'),
      skills: path.join(webDirectory, 'build/agent/skills'),
      verification: path.resolve(webDirectory, '../TEMP'),
      managed: false,
    }
  }
  const root = requireManagedPath(env.TERMOUS_BUILD_ROOT, configured)
  return {
    renderer: path.join(root, 'dist'), electron: path.join(root, 'dist-electron'),
    skills: path.join(root, 'skills'),
    verification: path.join(env.TERMOUS_BUILD_ROOT, 'work/verify/workers'), managed: true,
  }
}

export function requireManagedPath(rootValue, value) {
  if (!rootValue || !value || !path.isAbsolute(rootValue) || !path.isAbsolute(value)) {
    throw new Error('受管构建路径必须显式指定绝对根目录和产物路径')
  }
  const root = path.resolve(rootValue)
  const target = path.resolve(value)
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('产物超出构建根目录')
  for (let current = target; ; current = path.dirname(current)) {
    try {
      if (lstatSync(current).isSymbolicLink() || path.resolve(realpathSync(current)) !== current) {
        throw new Error(`受管构建路径不能经过链接：${current}`)
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (path.dirname(current) === current) break
  }
  const marker = JSON.parse(readFileSync(path.join(root, '.termous-build-root.json'), 'utf8'))
  if (marker.schema_version !== 1 || path.resolve(marker.root) !== root) throw new Error('构建根目录归属不匹配')
  return target
}
