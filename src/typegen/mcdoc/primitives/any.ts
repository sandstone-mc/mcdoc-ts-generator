import { prefix_sandstone_name } from '../../prefix'
import ts from 'typescript'
import type * as mcdoc from '@spyglassmc/mcdoc'
import type { TypeHandler } from '..'
import { Assert } from '../assert'
import { make_imports } from '../utils'

const { factory } = ts

const static_value = {
  type: factory.createTypeReferenceNode(prefix_sandstone_name('NBTObject')),
  imports: make_imports('sandstone::arguments::nbt::NBTObject'),
} as const

function mcdoc_any(type: mcdoc.McdocType) {
  const any = type
  Assert.KeywordType<'any'>(any)

  return (_args: Record<string, unknown>) => static_value
}

export const McdocAny = mcdoc_any satisfies TypeHandler
