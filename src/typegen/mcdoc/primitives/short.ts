import ts from 'typescript'
import type * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler } from '..'
import { Assert } from '../assert'
import { whole_number_generic } from './int'

const { factory } = ts

const NBTShortType = 'NBTShort'

function mcdoc_short(type: mcdoc.McdocType) {
  const short = type
  Assert.NumericType<'short'>(short)

  return (args: Record<string, unknown>) => {
    if (short.valueRange === undefined) {
      return {
        type: factory.createTypeReferenceNode(NBTShortType),
        imports: {
          ordered: [`sandstone::${NBTShortType}`] as NonEmptyList<string>,
          check: new Map([[`sandstone::${NBTShortType}`, 0]]) as Map<string, number>,
        },
      } as const
    } else {
      return whole_number_generic(short.valueRange, NBTShortType)
    }
  }
}

export const McdocShort = mcdoc_short satisfies TypeHandler
