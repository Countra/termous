import { createReadStream } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'

export const feedFaultModes = Object.freeze([
  'normal',
  'redirect_external',
  'metadata_404',
  'asset_404',
  'disconnect',
  'hash_mismatch',
  'slow',
])

const feedFaultModeSet = new Set(feedFaultModes)
const maximumControlBodyBytes = 4 * 1024
const minimumControlTokenLength = 24
const defaultSlowDelayMs = 35

export async function createUpdateSimulationFeed(options) {
  const rootDirectory = await realpath(path.resolve(options.rootDirectory))
  const controlToken = requireControlToken(options.controlToken)
  let faultMode = 'normal'

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/healthz') {
        return writeJson(response, 200, {
          status: 'ok',
          fault_mode: faultMode,
        }, request.method)
      }
      if (url.pathname === '/__control') {
        if (request.method !== 'POST') {
          return methodNotAllowed(response, ['POST'])
        }
        if (request.headers['x-termous-simulation-token'] !== controlToken) {
          return writeJson(response, 403, { error: 'forbidden' }, request.method)
        }
        const input = await readControlBody(request)
        if (!feedFaultModeSet.has(input.fault_mode)) {
          return writeJson(response, 400, { error: 'invalid_fault_mode' }, request.method)
        }
        faultMode = input.fault_mode
        return writeJson(response, 200, { fault_mode: faultMode }, request.method)
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return methodNotAllowed(response, ['GET', 'HEAD'])
      }

      const assetName = decodeAssetName(url.pathname)
      if (!assetName) {
        return writeJson(response, 404, { error: 'not_found' }, request.method)
      }
      const isMetadata = assetName === 'latest.yml'
      const isInstaller = assetName.toLowerCase().endsWith('.exe')
      if (faultMode === 'redirect_external' && isMetadata) {
        response.writeHead(302, {
          'Cache-Control': 'no-store',
          Location: 'https://example.invalid/escaped-latest.yml',
        })
        return response.end()
      }
      if (
        (faultMode === 'metadata_404' && isMetadata)
        || (faultMode === 'asset_404' && isInstaller)
      ) {
        return writeJson(response, 404, { error: 'not_found' }, request.method)
      }

      const asset = await resolveFeedAsset(rootDirectory, assetName)
      const range = parseSingleRange(request.headers.range, asset.size)
      if (range === 'invalid') {
        response.writeHead(416, {
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes */${asset.size}`,
          'Cache-Control': 'no-store',
        })
        return response.end()
      }
      const start = range?.start ?? 0
      const end = range?.end ?? asset.size - 1
      const contentLength = end - start + 1
      const statusCode = range ? 206 : 200
      const headers = {
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Content-Length': String(contentLength),
        'Content-Type': contentType(assetName),
        ...(range ? {
          'Content-Range': `bytes ${start}-${end}/${asset.size}`,
        } : {}),
      }
      response.writeHead(statusCode, headers)
      if (request.method === 'HEAD') {
        return response.end()
      }

      if (faultMode === 'disconnect' && isInstaller) {
        return disconnectResponse(response, asset.filePath, start, end)
      }

      const source = createReadStream(asset.filePath, { start, end })
      const transforms = []
      if (faultMode === 'hash_mismatch' && isInstaller) {
        transforms.push(createCorruptionTransform())
      }
      if (faultMode === 'slow' && isInstaller) {
        transforms.push(createDelayTransform(options.slowDelayMs))
      }
      await pipeline(source, ...transforms, response)
    } catch (error) {
      if (response.destroyed) {
        return
      }
      if (isMissingAssetError(error)) {
        return writeJson(response, 404, { error: 'not_found' }, request.method)
      }
      if (!response.headersSent) {
        return writeJson(response, 500, { error: 'feed_failure' }, request.method)
      }
      response.destroy()
    }
  })

  return {
    address: () => server.address(),
    close: () => closeServer(server),
    listen: (port = 18991) => listenLoopback(server, port),
  }
}

export async function resolveFeedAsset(rootDirectory, assetName) {
  if (
    !assetName
    || assetName !== path.posix.basename(assetName)
    || assetName !== path.win32.basename(assetName)
    || assetName === '.'
    || assetName === '..'
    || /[\0?#%]/.test(assetName)
  ) {
    throw missingAssetError()
  }
  const candidate = path.join(rootDirectory, assetName)
  const relative = path.relative(rootDirectory, candidate)
  if (
    !relative
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw missingAssetError()
  }
  const info = await lstat(candidate)
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) {
    throw missingAssetError()
  }
  const resolved = await realpath(candidate)
  if (path.dirname(resolved) !== rootDirectory) {
    throw missingAssetError()
  }
  return {
    filePath: resolved,
    size: info.size,
  }
}

export function parseSingleRange(value, size) {
  if (value === undefined) {
    return null
  }
  if (
    typeof value !== 'string'
    || !Number.isSafeInteger(size)
    || size <= 0
    || value.includes(',')
  ) {
    return 'invalid'
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || (!match[1] && !match[2])) {
    return 'invalid'
  }

  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return 'invalid'
    }
    return {
      start: Math.max(0, size - suffixLength),
      end: size - 1,
    }
  }

  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || start >= size
    || requestedEnd < start
  ) {
    return 'invalid'
  }
  return {
    start,
    end: Math.min(requestedEnd, size - 1),
  }
}

function decodeAssetName(pathname) {
  if (!pathname.startsWith('/') || pathname === '/') {
    return null
  }
  try {
    const decoded = decodeURIComponent(pathname.slice(1))
    return decoded.includes('/') || decoded.includes('\\') ? null : decoded
  } catch {
    return null
  }
}

function createCorruptionTransform() {
  let changed = false
  return new Transform({
    transform(chunk, _encoding, callback) {
      const output = Buffer.from(chunk)
      if (!changed && output.length > 0) {
        output[0] ^= 0xff
        changed = true
      }
      callback(null, output)
    },
  })
}

function createDelayTransform(value) {
  const delayMs = normalizeSlowDelay(value)
  return new Transform({
    transform(chunk, _encoding, callback) {
      setTimeout(() => callback(null, chunk), delayMs)
    },
  })
}

async function disconnectResponse(response, filePath, start, end) {
  const source = createReadStream(filePath, {
    start,
    end: Math.min(end, start + 128 * 1024 - 1),
  })
  try {
    for await (const chunk of source) {
      response.write(chunk)
      break
    }
  } finally {
    source.destroy()
    response.destroy()
  }
}

async function readControlBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.byteLength
    if (size > maximumControlBodyBytes) {
      throw new Error('control_body_too_large')
    }
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

function writeJson(response, statusCode, body, method) {
  const content = Buffer.from(JSON.stringify(body), 'utf8')
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': String(content.byteLength),
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(method === 'HEAD' ? undefined : content)
}

function methodNotAllowed(response, allowed) {
  response.setHeader('Allow', allowed.join(', '))
  return writeJson(response, 405, { error: 'method_not_allowed' }, 'GET')
}

function contentType(assetName) {
  return assetName.endsWith('.yml')
    ? 'application/yaml; charset=utf-8'
    : 'application/octet-stream'
}

function listenLoopback(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      resolve(server.address())
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

function requireControlToken(value) {
  if (typeof value !== 'string' || value.length < minimumControlTokenLength) {
    throw new Error('模拟更新源控制令牌无效')
  }
  return value
}

function normalizeSlowDelay(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 500
    ? value
    : defaultSlowDelayMs
}

function missingAssetError() {
  const error = new Error('feed_asset_not_found')
  error.code = 'ENOENT'
  return error
}

function isMissingAssetError(error) {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && error.code === 'ENOENT',
  )
}

async function main() {
  const rootDirectory = process.env.TERMOUS_UPDATE_SIMULATION_FEED_ROOT
  const controlToken = process.env.TERMOUS_UPDATE_SIMULATION_TOKEN
  if (!rootDirectory) {
    throw new Error('缺少 TERMOUS_UPDATE_SIMULATION_FEED_ROOT')
  }
  const feed = await createUpdateSimulationFeed({
    rootDirectory,
    controlToken,
  })
  const address = await feed.listen(18991)
  console.log(JSON.stringify({
    event: 'update_simulation_feed_ready',
    address,
  }))

  const shutdown = () => {
    void feed.close()
      .finally(() => process.exit(0))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

const entryPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null
if (entryPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
