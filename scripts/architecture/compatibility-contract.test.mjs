import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '../..')

test('旧 updateTypes 路径只保留公共合同的纯类型转发', () => {
  const compatibilityPath = path.join(projectRoot, 'electron/updateTypes.ts')
  const sourceFile = ts.createSourceFile(
    compatibilityPath,
    fs.readFileSync(compatibilityPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )

  assert.deepEqual(sourceFile.parseDiagnostics, [])
  assert.ok(sourceFile.statements.length > 0)
  for (const statement of sourceFile.statements) {
    assert.ok(
      ts.isExportDeclaration(statement),
      '兼容文件不能包含 import、声明或执行逻辑',
    )
    assert.equal(statement.isTypeOnly, true, '兼容出口必须使用 export type')
    assert.ok(
      statement.moduleSpecifier
        && ts.isStringLiteralLike(statement.moduleSpecifier)
        && statement.moduleSpecifier.text === '#common/contracts',
      '兼容出口只能指向 #common/contracts 公共入口',
    )
    if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      assert.ok(statement.exportClause.elements.length > 0, '兼容出口不能是空导出')
    }
  }
})
