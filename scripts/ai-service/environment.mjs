import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const workspace = fileURLToPath(new URL('../../../', import.meta.url))

export function developmentPython(env = process.env) {
  let python = env.TERMOUS_AI_PYTHON
  if (!python) {
    const conda = env.CONDA_EXE || env._CONDA_EXE || (process.platform === 'win32' ? 'conda.exe' : 'conda')
    const result = spawnSync(conda, ['env', 'list', '--json'], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
    if (result.error || result.status !== 0) throw new Error('无法查找 Conda termous-ai，请设置 TERMOUS_AI_PYTHON 为该环境的 Python 3.12 绝对路径。')
    const root = JSON.parse(result.stdout).envs.find(directory => path.basename(directory).toLowerCase() === 'termous-ai')
    if (root) python = path.join(root, process.platform === 'win32' ? 'python.exe' : 'bin/python')
  }
  if (!python || !path.isAbsolute(python) || !existsSync(python)) throw new Error('缺少 Conda termous-ai Python 解释器。')
  const check = spawnSync(python, ['-c', 'import sys,json; print(json.dumps([sys.version_info[:2],sys.prefix]))'], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
  if (check.error || check.status !== 0) throw new Error('无法运行 termous-ai Python。')
  const [version, prefix] = JSON.parse(check.stdout)
  if (version.join('.') !== '3.12' || path.basename(prefix).toLowerCase() !== 'termous-ai' || !existsSync(path.join(prefix, 'conda-meta'))) throw new Error('开发环境必须使用 Conda termous-ai / Python 3.12，不允许回退到 base。')
  return python
}

export function developmentEnvironment(env = process.env) {
  const python = developmentPython(env)
  const cache = env.TERMOUS_AI_CACHE || path.join(workspace, 'dev-data/.termous/cache/ai-service')
  const result = { ...env, PYTHON: python, TERMOUS_AI_PYTHON: python, TERMOUS_AI_DEVELOPMENT: '1',
    TERMOUS_AI_SOURCE: path.join(workspace, 'termous-aiService'), TERMOUS_AI_MODELS: path.join(workspace, 'termous-buildbin/models'),
    TERMOUS_AI_CACHE: cache, TERMOUS_DATA_DIR: path.join(workspace, 'dev-data'), PYTHONUTF8: '1', PYTHONNOUSERSITE: '1',
    PATH: `${path.dirname(python)}${path.delimiter}${path.join(path.dirname(python), 'Scripts')}${path.delimiter}${env.PATH || env.Path || ''}` }
  return result
}
