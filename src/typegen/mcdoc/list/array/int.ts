import ts from 'typescript'
import type * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler } from '../..'
import { Assert } from '../../assert'
import { length_range_generic } from '../list'

const { factory } = ts

const NBTIntArrayType = 'NBTIntArray'
const NBTIntArrayImport = `sandstone::${NBTIntArrayType}`

function mcdoc_int_array(type: mcdoc.McdocType) {
  Assert.ArrayType<'int_array'>(type)

  return (args: Record<string, unknown>) => {
    const imports = {
      ordered: [NBTIntArrayImport] as NonEmptyList<string>,
      check: new Map<string, number>([[NBTIntArrayImport, 0]]),
    }

    if (type.lengthRange) {
      const { generic, docs } = length_range_generic(type.lengthRange, 'Array')

      return {
        type: factory.createTypeReferenceNode(NBTIntArrayType, [
          factory.createTypeLiteralNode(generic),
        ]),
        imports,
        docs,
      } as const
    } else {
      return {
        type: factory.createTypeReferenceNode(NBTIntArrayType),
        imports,
      } as const
    }
  }
}

export const McdocIntArray = mcdoc_int_array satisfies TypeHandler
