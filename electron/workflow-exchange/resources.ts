import { ExchangeFailure, exchangeLimits, validHash } from './files.ts'

export const pathKey = (value: string) => value.normalize('NFC').toLowerCase().normalize('NFC')
export function validPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('assets/')) return false
  const name = value.slice(7)
  if (name.length <= 4 || Buffer.byteLength(name, 'utf8') > 128 || name.trim() !== name || name.startsWith('.') || name.endsWith('.') || !/\.png$/i.test(name)
    || /[^\p{L}\p{M}\p{N}\p{P}\p{S} ]/u.test(name) || /[/\\:<>"|?*]/u.test(name)) return false
  const base = name.split('.')[0].replace(/[ .]+$/, '').toUpperCase()
  return !/^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/.test(base)
}

export interface ExchangeAssetIndex { path: string; sha256: string; size: number; width: number; height: number }
export function assetIndex(value: unknown): ExchangeAssetIndex[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { assets?: unknown }).assets)) throw new ExchangeFailure('desktop_workflow_exchange_invalid')
  const assets = (value as { assets: unknown[] }).assets
  if (assets.length > exchangeLimits.assets) throw new ExchangeFailure('desktop_workflow_exchange_limit')
  const seen = new Set<string>(); let total = 0
  for (const raw of assets) {
    if (!raw || typeof raw !== 'object') throw new ExchangeFailure('desktop_workflow_exchange_invalid')
    const a = raw as ExchangeAssetIndex
    if (!validPath(a.path) || !validHash(a.sha256) || seen.has(pathKey(a.path)) || !Number.isSafeInteger(a.size) || a.size < 1 || a.size > exchangeLimits.image
      || !Number.isInteger(a.width) || !Number.isInteger(a.height) || a.width < 8 || a.height < 8 || a.width > 512 || a.height > 512) throw new ExchangeFailure('desktop_workflow_exchange_invalid')
    seen.add(pathKey(a.path)); total += a.size
  }
  if (total > exchangeLimits.content) throw new ExchangeFailure('desktop_workflow_exchange_limit')
  return assets as ExchangeAssetIndex[]
}

export function importAssets(value: unknown): { path: string }[] {
  if (!value || typeof value !== 'object') throw new ExchangeFailure('desktop_workflow_exchange_invalid')
  const manifest = value as { format?: unknown; format_version?: unknown; assets?: unknown; definition?: { steps?: unknown } }
  if (manifest.format !== 'termous.desktop-workflow' || manifest.format_version !== 1 || !Array.isArray(manifest.assets)) throw new ExchangeFailure('desktop_workflow_exchange_invalid')
  if (manifest.assets.length > exchangeLimits.assets) throw new ExchangeFailure('desktop_workflow_exchange_limit')
  const seen = new Set<string>()
  const assets = manifest.assets.map(raw => {
    if (raw && typeof raw === 'object' && ['sha256', 'size', 'width', 'height'].some(key => key in raw)) throw legacyFailure('assets')
    if (!raw || typeof raw !== 'object' || Object.keys(raw).some(key => key !== 'path') || !validPath(raw.path) || seen.has(pathKey(raw.path))) throw new ExchangeFailure('desktop_workflow_exchange_invalid')
    seen.add(pathKey(raw.path)); return { path: raw.path as string }
  })
  const references = new Set<string>(); let count = 0
  const image = (value: unknown) => {
    if (value === undefined) return
    if (!value || typeof value !== 'object') throw new ExchangeFailure('desktop_workflow_exchange_invalid')
    const im = value as { path?: unknown; asset_id?: unknown }
    if (im.asset_id !== undefined) throw legacyFailure('image.asset_id')
    if (typeof im.path !== 'string' || im.path && !validPath(im.path)) throw new ExchangeFailure('desktop_workflow_exchange_invalid')
    if (im.path) references.add(im.path)
  }
  const walk = (steps: unknown, depth: number) => {
    if (!Array.isArray(steps) || depth > 8 && steps.length > 0) throw new ExchangeFailure('desktop_workflow_exchange_invalid')
    for (const raw of steps) {
      if (!raw || typeof raw !== 'object' || ++count > 256) throw new ExchangeFailure('desktop_workflow_exchange_invalid')
      const step = raw as { image?: unknown; target?: { image?: unknown }; end_target?: { image?: unknown }; steps?: unknown; else?: unknown }
      image(step.image); image(step.target?.image); image(step.end_target?.image)
      walk(step.steps ?? [], depth + 1); walk(step.else ?? [], depth + 1)
    }
  }
  walk(manifest.definition?.steps, 1)
  if (assets.length !== references.size || assets.some(asset => !references.has(asset.path))) throw new ExchangeFailure('desktop_workflow_exchange_invalid')
  return assets
}

function legacyFailure(field: string) {
  return new ExchangeFailure('desktop_workflow_exchange_invalid', 400, 'desktop_workflow_exchange_invalid', { field, diagnostics: [{ field, code: 'exchange_format_legacy' }] })
}
