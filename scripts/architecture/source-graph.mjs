import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

export const expectedPackageImports = Object.freeze({
  '#app/*': './src/app/*/index.ts',
  '#pages/*': './src/pages/*/index.ts',
  '#widgets/*': './src/widgets/*/index.ts',
  '#features/*': './src/features/*/index.ts',
  '#entities/*': './src/entities/*/index.ts',
  '#shared/*': './src/shared/*/index.ts',
  '#common/*': './common/*/index.ts',
})

const governedRoots = new Set(['src', 'electron', 'common'])
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])
const typescriptSubstitutions = new Map([
  ['.js', ['.ts', '.tsx', '.d.ts']],
  ['.jsx', ['.tsx', '.ts', '.d.ts']],
  ['.mjs', ['.mts', '.d.mts', '.ts', '.d.ts']],
  ['.cjs', ['.cts', '.d.cts', '.ts', '.d.ts']],
])
const declarationExtensions = ['.d.ts', '.d.mts', '.d.cts']
const rendererBridgeProperties = new Set(['termous', 'termousUpdate'])

const toPosix = (value) => value.split(path.sep).join('/')
const foldedPath = (value) => path.resolve(value).toLocaleLowerCase('en-US')
const normalizedPath = (value) => path.normalize(path.resolve(value))

export function relativeProjectPath(projectRoot, value) {
  return toPosix(path.relative(projectRoot, value))
}

export function isTestSource(projectRoot, filePath) {
  const relative = relativeProjectPath(projectRoot, filePath)
  return relative.startsWith('src/test/')
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relative)
}

function collectSourceFiles(directory, projectRoot) {
  let directoryStat
  try {
    directoryStat = fs.lstatSync(directory)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }
    throw error
  }
  if (directoryStat.isSymbolicLink()) {
    throw new Error(`受管源码根不允许符号链接: ${relativeProjectPath(projectRoot, directory)}`)
  }
  if (!directoryStat.isDirectory()) {
    return []
  }
  const files = []
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`受管源码根不允许符号链接: ${relativeProjectPath(projectRoot, entryPath)}`)
    }
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath, projectRoot))
    } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(entryPath)
    }
  }
  return files
}

function readCompilerOptions(projectRoot) {
  const configPath = path.join(projectRoot, 'tsconfig.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, projectRoot)
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('\n'))
  }
  return { ...parsed.options, allowJs: true }
}

export function readPackageImports(projectRoot) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
  const actual = packageJson.imports
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    throw new Error('package.json#imports 缺失或格式无效')
  }
  const expectedKeys = Object.keys(expectedPackageImports)
    .sort((left, right) => left.localeCompare(right, 'en'))
  const actualKeys = Object.keys(actual).sort((left, right) => left.localeCompare(right, 'en'))
  const differences = []
  for (const key of expectedKeys) {
    if (actual[key] !== expectedPackageImports[key]) {
      differences.push(`${key} 应为 ${expectedPackageImports[key]}，实际为 ${JSON.stringify(actual[key])}`)
    }
  }
  for (const key of actualKeys) {
    if (!Object.hasOwn(expectedPackageImports, key)) {
      differences.push(`存在未纳入架构合同的别名 ${key}`)
    }
  }
  if (differences.length > 0) {
    throw new Error(`package.json#imports 与架构合同不一致：${differences.join('；')}`)
  }
  return new Map(expectedKeys.map((key) => [key, actual[key]]))
}

function importKind(node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause
    if (clause?.isTypeOnly) {
      return 'type'
    }
    if (
      clause?.namedBindings
      && ts.isNamedImports(clause.namedBindings)
      && clause.namedBindings.elements.length > 0
      && clause.namedBindings.elements.every((element) => element.isTypeOnly)
      && !clause.name
    ) {
      return 'type'
    }
  }
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) {
      return 'type'
    }
    if (
      node.exportClause
      && ts.isNamedExports(node.exportClause)
      && node.exportClause.elements.length > 0
      && node.exportClause.elements.every((element) => element.isTypeOnly)
    ) {
      return 'type'
    }
  }
  return 'static'
}

function pureReExportSpecifier(sourceFile) {
  if (sourceFile.statements.length === 0) {
    return null
  }
  const specifiers = []
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement)
      || !statement.moduleSpecifier
      || !ts.isStringLiteralLike(statement.moduleSpecifier)
      || (
        statement.exportClause
        && ts.isNamedExports(statement.exportClause)
        && statement.exportClause.elements.length === 0
      )
    ) {
      return null
    }
    specifiers.push(statement.moduleSpecifier.text)
  }
  const [first] = specifiers
  return first && specifiers.every((specifier) => specifier === first) ? first : null
}

function unwrapExpression(input) {
  let expression = input
  while (
    ts.isParenthesizedExpression(expression)
    || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression)
    || ts.isNonNullExpression(expression)
    || ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression
  }
  return expression
}

function isGlobalThisExpression(input) {
  const expression = unwrapExpression(input)
  return ts.isIdentifier(expression) && expression.text === 'globalThis'
}

function isWindowExpression(input) {
  const expression = unwrapExpression(input)
  if (ts.isIdentifier(expression)) {
    return expression.text === 'window'
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text === 'window' && isGlobalThisExpression(expression.expression)
  }
  return ts.isElementAccessExpression(expression)
    && Boolean(expression.argumentExpression)
    && ts.isStringLiteralLike(expression.argumentExpression)
    && expression.argumentExpression.text === 'window'
    && isGlobalThisExpression(expression.expression)
}

function staticPropertyName(node) {
  return node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node))
    ? node.text
    : null
}

function readModule(projectRoot, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  if (sourceFile.parseDiagnostics.length > 0) {
    const diagnostic = sourceFile.parseDiagnostics[0]
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    throw new Error(`${relativeProjectPath(projectRoot, filePath)} 无法解析: ${message}`)
  }
  const imports = []
  const windowBridgeReferences = []
  const addImport = (specifier, kind) => {
    if (typeof specifier === 'string' && specifier.length > 0) {
      imports.push({ specifier, kind })
    }
  }
  const addWindowBridgeReference = (property, kind) => {
    if (rendererBridgeProperties.has(property)) {
      windowBridgeReferences.push({ property, kind })
    }
  }
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        addImport(node.moduleSpecifier.text, importKind(node))
      }
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression
      && ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      addImport(node.moduleReference.expression.text, 'static')
    } else if (
      ts.isCallExpression(node)
      && node.arguments.length >= 1
      && ts.isStringLiteralLike(node.arguments[0])
    ) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addImport(node.arguments[0].text, 'dynamic')
      } else if (
        node.arguments.length === 1
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'require'
      ) {
        addImport(node.arguments[0].text, 'static')
      }
    } else if (
      ts.isImportTypeNode(node)
      && ts.isLiteralTypeNode(node.argument)
      && ts.isStringLiteralLike(node.argument.literal)
    ) {
      addImport(node.argument.literal.text, 'type')
    }
    if (ts.isPropertyAccessExpression(node) && isWindowExpression(node.expression)) {
      addWindowBridgeReference(node.name.text, 'property')
    } else if (
      ts.isElementAccessExpression(node)
      && isWindowExpression(node.expression)
      && node.argumentExpression
    ) {
      addWindowBridgeReference(staticPropertyName(node.argumentExpression), 'element')
    } else if (
      ts.isVariableDeclaration(node)
      && ts.isObjectBindingPattern(node.name)
      && node.initializer
      && isWindowExpression(node.initializer)
    ) {
      for (const element of node.name.elements) {
        addWindowBridgeReference(
          staticPropertyName(element.propertyName ?? element.name),
          'destructure',
        )
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return {
    imports,
    pathReferences: sourceFile.referencedFiles.map((reference) => reference.fileName),
    pureReExportSpecifier: pureReExportSpecifier(sourceFile),
    windowBridgeReferences,
  }
}

function aliasBasePath(projectRoot, specifier, packageImports) {
  for (const [pattern, targetPattern] of packageImports) {
    const wildcardIndex = pattern.indexOf('*')
    const prefix = pattern.slice(0, wildcardIndex)
    const suffix = pattern.slice(wildcardIndex + 1)
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
      continue
    }
    const wildcard = specifier.slice(prefix.length, specifier.length - suffix.length)
    return path.resolve(projectRoot, targetPattern.replace('*', wildcard))
  }
  return null
}

function resolutionCandidates(projectRoot, specifier, sourceFile, packageImports) {
  const basePath = specifier.startsWith('.')
    ? path.resolve(path.dirname(sourceFile), specifier)
    : aliasBasePath(projectRoot, specifier, packageImports)
  if (!basePath) {
    return []
  }
  const extension = path.extname(basePath)
  const candidates = [basePath]
  if (!sourceExtensions.has(extension)) {
    candidates.push(...[...sourceExtensions].map((item) => `${basePath}${item}`))
    candidates.push(...declarationExtensions.map((item) => `${basePath}${item}`))
    candidates.push(...[...sourceExtensions].map((item) => path.join(basePath, `index${item}`)))
    candidates.push(...declarationExtensions.map((item) => path.join(basePath, `index${item}`)))
  } else {
    const substitutions = typescriptSubstitutions.get(extension) ?? []
    const withoutExtension = basePath.slice(0, -extension.length)
    candidates.push(...substitutions.map((item) => `${withoutExtension}${item}`))
  }
  return [...new Set(candidates.map(normalizedPath))]
}

function realPathIfFile(candidate) {
  try {
    if (!fs.statSync(candidate).isFile()) {
      return null
    }
    return fs.realpathSync.native(candidate)
  } catch {
    return null
  }
}

function sourceLookup(files) {
  const byRealPath = new Map()
  const byFoldedPath = new Map()
  for (const file of files) {
    const realPath = fs.realpathSync.native(file)
    byRealPath.set(normalizedPath(realPath), file)
    const folded = foldedPath(realPath)
    const matches = byFoldedPath.get(folded) ?? []
    matches.push(file)
    byFoldedPath.set(folded, matches)
  }
  return { byRealPath, byFoldedPath }
}

function governedTarget(candidate, candidates, lookup) {
  const realCandidate = candidate ? realPathIfFile(candidate) : null
  let targetFile = realCandidate ? lookup.byRealPath.get(normalizedPath(realCandidate)) : null
  if (!targetFile) {
    for (const requested of candidates) {
      const exact = lookup.byRealPath.get(normalizedPath(requested))
      if (exact) {
        targetFile = exact
        break
      }
      const foldedMatches = lookup.byFoldedPath.get(foldedPath(requested)) ?? []
      if (foldedMatches.length > 0) {
        targetFile = foldedMatches
          .sort((left, right) => left.localeCompare(right, 'en'))[0]
        break
      }
    }
  }
  if (!targetFile) {
    return null
  }
  const actual = normalizedPath(fs.realpathSync.native(targetFile))
  const caseExact = candidates.some((requested) => normalizedPath(requested) === actual)
  return { targetFile, caseMismatch: !caseExact }
}

function isProjectLocalOutsideRoots(projectRoot, candidate) {
  const realCandidate = realPathIfFile(candidate)
  if (!realCandidate || !sourceExtensions.has(path.extname(realCandidate))) {
    return null
  }
  const relative = relativeProjectPath(fs.realpathSync.native(projectRoot), realCandidate)
  if (relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative)) {
    const [root] = relative.split('/')
    if (governedRoots.has(root) || root === 'node_modules') {
      return null
    }
  }
  return realCandidate
}

function resolveImport(
  projectRoot,
  specifier,
  sourceFile,
  compilerOptions,
  packageImports,
  lookup,
) {
  const candidates = resolutionCandidates(projectRoot, specifier, sourceFile, packageImports)
  const compilerCandidate = ts.resolveModuleName(
    specifier,
    sourceFile,
    compilerOptions,
    ts.sys,
  ).resolvedModule?.resolvedFileName
  const existingCandidate = compilerCandidate
    ?? candidates.map(realPathIfFile).find(Boolean)
    ?? null
  const governed = governedTarget(existingCandidate, candidates, lookup)
  if (governed) {
    return governed
  }
  if (!specifier.startsWith('.') && !specifier.startsWith('#')) {
    return null
  }
  const outOfScopeFile = existingCandidate
    ? isProjectLocalOutsideRoots(projectRoot, existingCandidate)
    : null
  return outOfScopeFile ? { outOfScopeFile } : null
}

export function buildProjectGraph(inputRoot) {
  const projectRoot = path.resolve(inputRoot)
  const packageImports = readPackageImports(projectRoot)
  const compilerOptions = readCompilerOptions(projectRoot)
  const allSourceFiles = [...governedRoots]
    .flatMap((root) => collectSourceFiles(path.join(projectRoot, root), projectRoot))
  const productionSourceFiles = allSourceFiles
    .filter((file) => !isTestSource(projectRoot, file))
  const lookup = sourceLookup(allSourceFiles)
  const edges = []
  const externalImports = []
  const outOfScopeImports = []
  const pathReferences = []
  const windowBridgeReferences = []
  for (const sourceFile of productionSourceFiles) {
    const module = readModule(projectRoot, sourceFile)
    for (const specifier of module.pathReferences) {
      pathReferences.push({ sourceFile, specifier })
    }
    for (const reference of module.windowBridgeReferences) {
      windowBridgeReferences.push({ sourceFile, ...reference })
    }
    for (const imported of module.imports) {
      if (!imported.specifier.startsWith('.') && !imported.specifier.startsWith('#')) {
        externalImports.push({ sourceFile, ...imported })
      }
      const resolved = resolveImport(
        projectRoot,
        imported.specifier,
        sourceFile,
        compilerOptions,
        packageImports,
        lookup,
      )
      if (resolved?.targetFile) {
        edges.push({
          sourceFile,
          targetFile: resolved.targetFile,
          caseMismatch: resolved.caseMismatch,
          pureReExportSpecifier: module.pureReExportSpecifier,
          ...imported,
        })
      } else if (resolved?.outOfScopeFile) {
        outOfScopeImports.push({
          sourceFile,
          targetFile: resolved.outOfScopeFile,
          ...imported,
        })
      }
    }
  }
  return {
    projectRoot,
    allSourceFiles,
    productionSourceFiles,
    edges,
    externalImports,
    outOfScopeImports,
    pathReferences,
    windowBridgeReferences,
  }
}
