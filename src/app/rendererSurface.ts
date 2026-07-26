export type RendererSurface = 'main' | 'update'

export function resolveRendererSurface(search: string): RendererSurface {
  return new URLSearchParams(search).get('surface') === 'update' ? 'update' : 'main'
}

export function loadRendererSurface<T>(
  search: string,
  loaders: Record<RendererSurface, () => Promise<T>>,
) {
  return loaders[resolveRendererSurface(search)]()
}
