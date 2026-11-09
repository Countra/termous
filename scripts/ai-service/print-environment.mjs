import { developmentEnvironment } from './environment.mjs'

const configured = developmentEnvironment()
const keys = ['PYTHON', 'TERMOUS_AI_PYTHON', 'TERMOUS_AI_SOURCE', 'TERMOUS_AI_MODELS', 'TERMOUS_AI_CACHE', 'TERMOUS_DATA_DIR',
  'PYTHONUTF8', 'PYTHONNOUSERSITE', 'PATH', 'GOCACHE', 'GOMODCACHE', 'GOTMPDIR', 'PIP_CACHE_DIR', 'PYTHONPYCACHEPREFIX',
  'TORCH_HOME', 'CUDA_CACHE_PATH', 'TORCHINDUCTOR_CACHE_DIR']
process.stdout.write(JSON.stringify(Object.fromEntries(keys.map(key => [key, configured[key]]))))
