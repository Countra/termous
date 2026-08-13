import {
  buildProjectGraph,
  expectedPackageImports,
  isTestSource,
  readPackageImports,
  relativeProjectPath,
} from './source-graph.mjs'

export { expectedPackageImports, readPackageImports }

const slicedLayers = new Set(['pages', 'widgets', 'features', 'entities', 'shared'])
const layerRanks = new Map([
  ['shared', 0],
  ['entities', 1],
  ['features', 2],
  ['widgets', 3],
  ['pages', 4],
  ['app', 5],
])

function classify(projectRoot, filePath) {
  const parts = relativeProjectPath(projectRoot, filePath).split('/')
  if (isTestSource(projectRoot, filePath)) {
    return {
      realm: 'test', layer: null, slice: null, legacyLocation: false,
      legacyBoundary: false, layerRoot: false, parts,
    }
  }
  if (parts[0] === 'electron') {
    return {
      realm: 'electron', layer: null, slice: null, legacyLocation: false,
      legacyBoundary: false, layerRoot: false, parts,
    }
  }
  if (parts[0] === 'common') {
    const layerRoot = parts.length === 2
    return {
      realm: 'common', layer: 'common', slice: parts.length >= 3 ? parts[1] : null,
      legacyLocation: false, legacyBoundary: layerRoot, layerRoot, parts,
    }
  }
  if (parts[0] !== 'src') {
    return {
      realm: 'other', layer: null, slice: null, legacyLocation: false,
      legacyBoundary: false, layerRoot: false, parts,
    }
  }
  const layer = layerRanks.has(parts[1]) ? parts[1] : null
  const layerRoot = Boolean(layer && slicedLayers.has(layer) && parts.length === 3)
  const slice = layer
    && (slicedLayers.has(layer) || layer === 'app')
    && parts.length >= 4
    ? parts[2]
    : null
  const legacyLocation = !layer
  return {
    realm: 'renderer', layer, slice, legacyLocation,
    legacyBoundary: legacyLocation || layerRoot, layerRoot, parts,
  }
}

function isPublicEntry(info) {
  if (!info.slice || !/^index\.[cm]?[jt]sx?$/.test(info.parts.at(-1))) {
    return false
  }
  return info.realm === 'common' ? info.parts.length === 3 : info.parts.length === 4
}

function canonicalPublicSpecifier(info) {
  return info.slice ? `#${info.layer}/${info.slice}` : null
}

export function violationKey(violation) {
  return [
    violation.rule,
    violation.source,
    violation.target ?? '',
    violation.specifier ?? '',
    violation.kind ?? '',
  ].join('\u0000')
}

function addViolation(violations, violation) {
  violations.set(violationKey(violation), violation)
}

function isPureCompatibilityReExport(sourceInfo, targetInfo, edge) {
  return sourceInfo.realm === 'renderer'
    && sourceInfo.legacyBoundary
    && targetInfo.realm === 'renderer'
    && !targetInfo.legacyBoundary
    && isPublicEntry(targetInfo)
    && edge.pureReExportSpecifier === edge.specifier
    && edge.specifier === canonicalPublicSpecifier(targetInfo)
}

function isLegacySharedPublicDependency(sourceInfo, targetInfo, edge) {
  return sourceInfo.realm === 'renderer'
    && sourceInfo.legacyBoundary
    && targetInfo.realm === 'renderer'
    && targetInfo.layer === 'shared'
    && !targetInfo.legacyBoundary
    && isPublicEntry(targetInfo)
    && edge.specifier === canonicalPublicSpecifier(targetInfo)
}

function isRendererBridgeSource(info) {
  return info.realm === 'renderer'
    && info.layer === 'shared'
    && info.slice === 'bridge'
}

function collectFileViolations(projectRoot, sourceFiles, violations) {
  for (const sourceFile of sourceFiles) {
    const info = classify(projectRoot, sourceFile)
    if (info.layerRoot) {
      addViolation(violations, {
        rule: 'layer-root-file',
        source: relativeProjectPath(projectRoot, sourceFile),
      })
    }
    if (info.legacyLocation) {
      addViolation(violations, {
        rule: 'legacy-file',
        source: relativeProjectPath(projectRoot, sourceFile),
      })
    }
  }
}

function collectEdgeViolations(projectRoot, edges, violations) {
  for (const edge of edges) {
    const sourceInfo = classify(projectRoot, edge.sourceFile)
    const targetInfo = classify(projectRoot, edge.targetFile)
    const base = {
      source: relativeProjectPath(projectRoot, edge.sourceFile),
      target: relativeProjectPath(projectRoot, edge.targetFile),
      specifier: edge.specifier,
    }
    if (edge.caseMismatch) {
      addViolation(violations, { rule: 'import-path-case', ...base })
    }
    if (targetInfo.realm === 'test') {
      addViolation(violations, { rule: 'production-test-import', ...base })
      continue
    }
    if (sourceInfo.realm === 'renderer' && targetInfo.realm === 'electron') {
      addViolation(violations, { rule: 'renderer-electron', ...base })
    } else if (
      (sourceInfo.realm === 'electron' && targetInfo.realm === 'renderer')
      || (sourceInfo.realm === 'common' && targetInfo.realm !== 'common')
    ) {
      addViolation(violations, { rule: 'layer-direction', ...base })
    }
    if (
      sourceInfo.realm === 'renderer'
      && targetInfo.realm === 'renderer'
      && (sourceInfo.legacyBoundary || targetInfo.legacyBoundary)
      && !isPureCompatibilityReExport(sourceInfo, targetInfo, edge)
      && !isLegacySharedPublicDependency(sourceInfo, targetInfo, edge)
    ) {
      addViolation(violations, { rule: 'legacy-boundary', ...base })
    }
    if (
      sourceInfo.realm === 'renderer'
      && targetInfo.realm === 'renderer'
      && sourceInfo.layer
      && targetInfo.layer
      && layerRanks.get(sourceInfo.layer) < layerRanks.get(targetInfo.layer)
    ) {
      addViolation(violations, { rule: 'layer-direction', ...base })
    }
    const targetIsSlice = targetInfo.slice
      && (targetInfo.realm === 'renderer' || targetInfo.realm === 'common')
    if (!targetIsSlice) {
      continue
    }
    const sameSlice = sourceInfo.realm === targetInfo.realm
      && sourceInfo.layer === targetInfo.layer
      && sourceInfo.slice === targetInfo.slice
    if (sameSlice) {
      if (!edge.specifier.startsWith('.')) {
        addViolation(violations, { rule: 'slice-internal-alias', ...base })
      } else if (isPublicEntry(targetInfo) && edge.sourceFile !== edge.targetFile) {
        addViolation(violations, { rule: 'slice-internal-public-entry', ...base })
      }
      continue
    }
    const publicEntryValid = isPublicEntry(targetInfo)
      && edge.specifier === canonicalPublicSpecifier(targetInfo)
    if (!publicEntryValid) {
      addViolation(violations, { rule: 'public-entry', ...base })
    }
    if (
      sourceInfo.realm === targetInfo.realm
      && sourceInfo.layer === targetInfo.layer
      && sourceInfo.slice
      && sourceInfo.slice !== targetInfo.slice
      && !isPublicEntry(targetInfo)
    ) {
      addViolation(violations, { rule: 'same-layer-deep-import', ...base })
    }
  }
}

function collectOutOfScopeViolations(projectRoot, outOfScopeImports, violations) {
  for (const edge of outOfScopeImports) {
    addViolation(violations, {
      rule: 'out-of-scope-local-import',
      source: relativeProjectPath(projectRoot, edge.sourceFile),
      target: relativeProjectPath(projectRoot, edge.targetFile),
      specifier: edge.specifier,
    })
  }
}

function collectExternalImportViolations(projectRoot, externalImports, violations) {
  for (const imported of externalImports) {
    const sourceInfo = classify(projectRoot, imported.sourceFile)
    if (
      sourceInfo.realm !== 'renderer'
      || (
        imported.specifier !== 'electron'
        && !imported.specifier.startsWith('electron/')
      )
    ) {
      continue
    }
    addViolation(violations, {
      rule: 'renderer-electron-package',
      source: relativeProjectPath(projectRoot, imported.sourceFile),
      specifier: imported.specifier,
      kind: imported.kind,
    })
  }
}

function collectWindowBridgeViolations(projectRoot, references, violations) {
  for (const reference of references) {
    const sourceInfo = classify(projectRoot, reference.sourceFile)
    if (sourceInfo.realm !== 'renderer' || isRendererBridgeSource(sourceInfo)) {
      continue
    }
    addViolation(violations, {
      rule: 'renderer-window-termous',
      source: relativeProjectPath(projectRoot, reference.sourceFile),
      specifier: `window.${reference.property}`,
      kind: reference.kind,
    })
  }
}

function collectPathReferenceViolations(projectRoot, pathReferences, violations) {
  for (const reference of pathReferences) {
    addViolation(violations, {
      rule: 'triple-slash-path-reference',
      source: relativeProjectPath(projectRoot, reference.sourceFile),
      specifier: reference.specifier,
    })
  }
}

function findStronglyConnectedComponents(files, edges) {
  const adjacency = new Map(files.map((file) => [file, []]))
  for (const edge of edges) {
    adjacency.get(edge.sourceFile)?.push(edge.targetFile)
  }
  const indexByFile = new Map()
  const lowLinkByFile = new Map()
  const stack = []
  const onStack = new Set()
  const components = []
  let nextIndex = 0
  const connect = (file) => {
    indexByFile.set(file, nextIndex)
    lowLinkByFile.set(file, nextIndex)
    nextIndex += 1
    stack.push(file)
    onStack.add(file)
    for (const target of adjacency.get(file) ?? []) {
      if (!indexByFile.has(target)) {
        connect(target)
        lowLinkByFile.set(file, Math.min(lowLinkByFile.get(file), lowLinkByFile.get(target)))
      } else if (onStack.has(target)) {
        lowLinkByFile.set(file, Math.min(lowLinkByFile.get(file), indexByFile.get(target)))
      }
    }
    if (lowLinkByFile.get(file) !== indexByFile.get(file)) {
      return
    }
    const component = []
    let member
    do {
      member = stack.pop()
      onStack.delete(member)
      component.push(member)
    } while (member !== file)
    components.push(component)
  }
  for (const file of files) {
    if (!indexByFile.has(file)) {
      connect(file)
    }
  }
  return components
}

function addCycleViolations(projectRoot, violations, files, edges) {
  const cyclicComponentByFile = new Map()
  for (const component of findStronglyConnectedComponents(files, edges)) {
    if (component.length > 1) {
      const members = new Set(component)
      for (const file of component) {
        cyclicComponentByFile.set(file, members)
      }
    }
  }
  for (const edge of edges) {
    const component = cyclicComponentByFile.get(edge.sourceFile)
    if (edge.sourceFile !== edge.targetFile && !component?.has(edge.targetFile)) {
      continue
    }
    addViolation(violations, {
      rule: 'import-cycle',
      source: relativeProjectPath(projectRoot, edge.sourceFile),
      target: relativeProjectPath(projectRoot, edge.targetFile),
      specifier: edge.specifier,
      kind: edge.kind,
    })
  }
}

export function collectArchitectureViolations(inputRoot) {
  const graph = buildProjectGraph(inputRoot)
  const violations = new Map()
  collectFileViolations(graph.projectRoot, graph.productionSourceFiles, violations)
  collectEdgeViolations(graph.projectRoot, graph.edges, violations)
  collectExternalImportViolations(graph.projectRoot, graph.externalImports, violations)
  collectOutOfScopeViolations(graph.projectRoot, graph.outOfScopeImports, violations)
  collectPathReferenceViolations(graph.projectRoot, graph.pathReferences, violations)
  collectWindowBridgeViolations(graph.projectRoot, graph.windowBridgeReferences, violations)
  addCycleViolations(graph.projectRoot, violations, graph.allSourceFiles, graph.edges)
  return [...violations.values()]
    .sort((left, right) => violationKey(left).localeCompare(violationKey(right), 'en'))
}
