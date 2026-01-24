import ts from 'typescript'
import type * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler } from '..'
import { Assert } from '../assert'

const { factory } = ts

const static_value = {
  type: factory.createTypeReferenceNode('NBTObject'),
  imports: {
    ordered: ['sandstone::arguments::nbt::NBTObject'] as NonEmptyList<string>,
    check: new Map([['sandstone::arguments::nbt::NBTObject', 0]]),
  },
} as const

function mcdoc_any(type: mcdoc.McdocType) {
  const any = type
  Assert.KeywordType<'any'>(any)

  return (args: Record<string, unknown>) => static_value
}

export const McdocAny = mcdoc_any satisfies TypeHandler
