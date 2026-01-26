import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler } from '..'
import { Assert } from '../assert'
import { whole_number_generic } from './int'

const { factory } = ts

const NBTByteType = 'NBTByte'

function mcdoc_byte(type: mcdoc.McdocType) {
  const byte = type
  Assert.NumericType<'byte'>(byte)

  return (args: Record<string, unknown>) => {
    if (byte.valueRange === undefined) {
      return {
        type: factory.createTypeReferenceNode(NBTByteType),
        imports: {
          ordered: [`sandstone::${NBTByteType}`] as NonEmptyList<string>,
          check: new Map([[`sandstone::${NBTByteType}`, 0]]) as Map<string, number>,
        },
      } as const
    } else {
      return whole_number_generic(byte.valueRange, NBTByteType)
    }
  }
}

export const McdocByte = mcdoc_byte satisfies TypeHandler