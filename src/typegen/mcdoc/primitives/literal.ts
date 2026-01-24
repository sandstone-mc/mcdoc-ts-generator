import ts from 'typescript'
import type * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler } from '..'
import { Assert } from '../assert'
import { match, P } from 'ts-pattern'
import { Bind } from '../bind'

const { factory } = ts

const boolean_static = {
  true: {
    type: factory.createLiteralTypeNode(factory.createTrue()),
  },
  false: {
    type: factory.createLiteralTypeNode(factory.createFalse()),
  },
} as const

function mcdoc_literal(type: mcdoc.McdocType) {
  const literal = type
  Assert.LiteralType(literal)

  return (args: Record<string, unknown>) => match(literal.value)
    .with({ kind: 'boolean' }, (boolean) => match(boolean.value)
      .with(true, () => boolean_static.true)
      .with(false, () => boolean_static.false)
      .exhaustive(),
    )
    .with({ kind: 'byte' }, (byte) => {
      const type = 'NBTByte'

      return {
        type: factory.createTypeReferenceNode(type, [
          Bind.NumericLiteral(byte.value),
        ]),
        imports: {
          ordered: [`sandstone::${type}`] as NonEmptyList<string>,
          check: new Map([[`sandstone::${type}`, 0]]) as Map<string, number>,
        },
      } as const
    }).narrow() // I have no idea why this `narrow` is only actually needed here and not after `float`
    .with({ kind: 'double' }, { kind: 'int' }, (num) => ({
      type: Bind.NumericLiteral(num.value),
    }))
    .with({ kind: 'float' }, (float) => {
      const type = 'NBTFloat'

      return {
        type: factory.createTypeReferenceNode(type, [
          Bind.NumericLiteral(float.value),
        ]),
        imports: {
          ordered: [`sandstone::${type}`] as NonEmptyList<string>,
          check: new Map([[`sandstone::${type}`, 0]]) as Map<string, number>,
        },
      } as const
    })
    .with({ kind: 'long' }, (long) => {
      const type = 'NBTLong'

      return {
        type: factory.createTypeReferenceNode(type, [
          Bind.StringLiteral(`${long.value}`),
        ]),
        imports: {
          ordered: [`sandstone::${type}`] as NonEmptyList<string>,
          check: new Map([[`sandstone::${type}`, 0]]) as Map<string, number>,
        },
      } as const
    })
    .with({ kind: 'short' }, (short) => {
      const type = 'NBTShort'

      return {
        type: factory.createTypeReferenceNode(type, [
          Bind.NumericLiteral(short.value),
        ]),
        imports: {
          ordered: [`sandstone::${type}`] as NonEmptyList<string>,
          check: new Map([[`sandstone::${type}`, 0]]) as Map<string, number>,
        },
      } as const
    })
    .with({ kind: 'string' }, (string) => ({
      type: Bind.StringLiteral(string.value),
    }))
    .exhaustive()
}

export const McdocLiteral = mcdoc_literal satisfies TypeHandler
