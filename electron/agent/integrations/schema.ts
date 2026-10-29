import * as Schema from 'typebox/schema'
import { Compile } from 'typebox/compile'
import type { TSchema } from 'typebox'
import { Format } from 'typebox/format'

const annotations = new Set(['title','description','default','examples','deprecated','readOnly','writeOnly','$comment','contentEncoding','contentMediaType'])
const maps = new Set(['properties','patternProperties','$defs','definitions','dependentSchemas'])
const lists = new Set(['allOf','anyOf','oneOf','prefixItems'])
const children = new Set(['additionalProperties','unevaluatedProperties','propertyNames','contains','additionalItems','unevaluatedItems','if','then','else','not'])
const aliases: Record<string,string> = {$defs:'IsDefs',definitions:'IsDefs',$ref:'IsRef',$id:'IsId',$anchor:'IsAnchor',$dynamicRef:'IsDynamicRef',$dynamicAnchor:'IsDynamicAnchor',$recursiveRef:'IsRecursiveRef',$recursiveAnchor:'IsRecursiveAnchor'}

// 不兼容约束必须隔离整项工具，不能让编译器忽略未知关键字后扩大允许的参数范围。
export function validateIntegrationSchema(schema: Record<string,unknown>) {
  if (schema.type !== 'object' || Buffer.byteLength(JSON.stringify(schema)) > 128 * 1024) throw new Error('INTEGRATION_TOOL_SCHEMA_UNSUPPORTED')
  let nodes=0
  const visit=(value:unknown,depth:number) => {
    if (++nodes>4096 || depth>64) throw new Error('INTEGRATION_TOOL_SCHEMA_UNSUPPORTED')
    if (typeof value==='boolean') return
    if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('INTEGRATION_TOOL_SCHEMA_UNSUPPORTED')
    const object=value as Record<string,unknown>
    for (const [key,child] of Object.entries(object)) {
      if (annotations.has(key)) continue
      if (key==='$schema') {
        if (typeof child!=='string' || !/^https?:\/\/json-schema\.org\/(draft-07\/schema#?|draft\/(2019-09|2020-12)\/schema#?)$/u.test(child)) throw new Error('INTEGRATION_TOOL_SCHEMA_UNSUPPORTED')
        continue
      }
      const guard=(Schema as unknown as Record<string,(value:unknown)=>boolean>)[aliases[key] ?? `Is${key[0].toUpperCase()}${key.slice(1)}`]
      if (key==='format' && (typeof child!=='string' || !Format.Has(child))) throw new Error('INTEGRATION_TOOL_SCHEMA_UNSUPPORTED')
      if (!guard || !(key==='definitions' ? Schema.IsDefs({$defs:child}) : guard(object))) throw new Error('INTEGRATION_TOOL_SCHEMA_UNSUPPORTED')
      if (['$ref','$dynamicRef','$recursiveRef'].includes(key) && (typeof child!=='string' || !child.startsWith('#'))) throw new Error('INTEGRATION_TOOL_SCHEMA_UNSUPPORTED')
      if (maps.has(key)) Object.values(child as Record<string,unknown>).forEach(item=>visit(item,depth+1))
      else if (lists.has(key) || key==='items' && Array.isArray(child)) (child as unknown[]).forEach(item=>visit(item,depth+1))
      else if (children.has(key) || key==='items') visit(child,depth+1)
      else if (key==='dependencies') Object.values(child as Record<string,unknown>).filter(item=>!Array.isArray(item)).forEach(item=>visit(item,depth+1))
    }
  }
  visit(schema,0)
  return Compile(schema as TSchema)
}
