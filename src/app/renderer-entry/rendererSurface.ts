export type RendererSurface = 'main' | 'update' | 'remote' | 'desktop' | 'desktop-automation'

export function resolveRendererSurface(search: string): RendererSurface {
  const value = new URLSearchParams(search).get('surface')
  return value === 'remote' || value === 'update' || value === 'desktop' || value === 'desktop-automation' ? value : 'main'
}

export function loadRendererSurface<T>(
  search: string,
  loaders: Record<RendererSurface, () => Promise<T>>,
) {
  return loaders[resolveRendererSurface(search)]()
}
