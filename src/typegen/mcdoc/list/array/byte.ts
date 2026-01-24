import ts from 'typescript'
import type * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler } from '../..'
import { Assert } from '../../assert'
import { length_range_generic } from '../list'

const { factory } = ts

const NBTByteArrayType = 'NBTByteArray'
const NBTByteArrayImport = `sandstone::${NBTByteArrayType}`

function mcdoc_byte_array(type: mcdoc.McdocType) {
  Assert.ArrayType<'byte_array'>(type)

  return (args: Record<string, unknown>) => {
    const imports = {
      ordered: [NBTByteArrayImport] as NonEmptyList<string>,
      check: new Map<string, number>([[NBTByteArrayImport, 0]]),
    }

    if (type.lengthRange) {
      const { generic, docs } = length_range_generic(type.lengthRange, 'Array')

      return {
        type: factory.createTypeReferenceNode(NBTByteArrayType, [
          factory.createTypeLiteralNode(generic),
        ]),
        imports,
        docs,
      } as const
    } else {
      return {
        type: factory.createTypeReferenceNode(NBTByteArrayType),
        imports,
      } as const
    }
  }
}

export const McdocByteArray = mcdoc_byte_array satisfies TypeHandler
