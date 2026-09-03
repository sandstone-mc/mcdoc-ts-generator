import ts from '@typescript/typescript6'
import type * as mcdoc from '@spyglassmc/mcdoc'
import type { TypeHandler } from '..'
import { Assert } from '../assert'
import { Bind } from '../bind'

const { factory } = ts

export function enum_docs(enum_type: mcdoc.EnumType) {
  const docs = ['']

  for (const member of enum_type.values) {
    const id_value = `${member.identifier}(\`${member.value}\`)`
    if (member.desc) {
      const member_doc = member.desc.trim().split('\n')

      if (member_doc.length > 1) {
        docs.push(` - ${id_value}:`)
        docs.push(...member_doc.map((doc) => `   ${doc}`))
      } else {
        docs.push(` - ${id_value}: ${member_doc[0]}`)
      }
    } else {
      docs.push(` - ${id_value}`)
    }
  }

  return docs
}

function mcdoc_enum(type: mcdoc.McdocType) {
  const enum_type = type
  Assert.EnumType(enum_type)

  return (_args: Record<string, unknown>) => {
    // Empty enum body (e.g. `enum(string) {}`) has no members — `createUnionTypeNode([])`
    // would print as `()`, which is invalid TS. Resolve to `never` instead.
    if (enum_type.values.length === 0) {
      return {
        type: factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword),
      } as const
    }

    const bind_value = (() => enum_type.enumKind === 'string'
      ? (value: string | number | bigint) => Bind.StringLiteral(value as string)
      : (value: number | bigint | string) => Bind.NumericLiteral(value as number | bigint))()

    const members: ts.LiteralTypeNode[] = enum_type.values.map(({ value }) => bind_value(value))

    return {
      type: factory.createParenthesizedType(factory.createUnionTypeNode(members)),
    } as const
  }
}

export const McdocEnum = mcdoc_enum satisfies TypeHandler
