export type RendererSurface = 'main' | 'update' | 'remote'

export function resolveRendererSurface(search: string): RendererSurface {
  const value = new URLSearchParams(search).get('surface')
  return value === 'remote' || value === 'update' ? value : 'main'
}

export function loadRendererSurface<T>(
  search: string,
  loaders: Record<RendererSurface, () => Promise<T>>,
) {
  return loaders[resolveRendererSurface(search)]()
}
