import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import {
  loadRendererSurface,
  resolveRendererSurface,
} from '../app/rendererSurface.ts'

test('仅显式 update surface 加载独立更新界面', () => {
  assert.equal(resolveRendererSurface('?surface=update'), 'update')
  assert.equal(resolveRendererSurface('?surface=main'), 'main')
  assert.equal(resolveRendererSurface('?surface=UPDATE'), 'main')
  assert.equal(resolveRendererSurface(''), 'main')
})

test('surface 分流只调用目标模块加载器', async () => {
  const calls: string[] = []
  const result = await loadRendererSurface('?surface=update', {
    main: async () => {
      calls.push('main')
      return 'main'
    },
    update: async () => {
      calls.push('update')
      return 'update'
    },
  })

  assert.equal(result, 'update')
  assert.deepEqual(calls, ['update'])
})

test('Renderer 启动入口保持 main 与 update 模块映射', () => {
  const mainPath = fileURLToPath(new URL('../main.tsx', import.meta.url))
  const sourceFile = ts.createSourceFile(
    mainPath,
    fs.readFileSync(mainPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const loaders: Record<string, string> = {}

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'loadRendererSurface'
      && node.arguments.length >= 2
      && ts.isObjectLiteralExpression(node.arguments[1])
    ) {
      for (const property of node.arguments[1].properties) {
        if (
          !ts.isPropertyAssignment(property)
          || !ts.isIdentifier(property.name)
          || !ts.isArrowFunction(property.initializer)
          || !ts.isCallExpression(property.initializer.body)
          || property.initializer.body.expression.kind !== ts.SyntaxKind.ImportKeyword
          || property.initializer.body.arguments.length !== 1
          || !ts.isStringLiteralLike(property.initializer.body.arguments[0])
        ) {
          continue
        }
        loaders[property.name.text] = property.initializer.body.arguments[0].text
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.deepEqual(loaders, {
    main: './App.tsx',
    update: './features/update/UpdateWindowRoot.tsx',
  })
})
