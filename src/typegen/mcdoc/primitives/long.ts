import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { TypeHandler } from '..'
import { Assert } from '../assert'
import { whole_number_generic } from './int'

const { factory } = ts

const NBTLongType = 'NBTLong'

function mcdoc_long(type: mcdoc.McdocType) {
    const long = type
    Assert.NumericType<'long'>(long)

    return (...args: unknown[]) => {
        if (long.valueRange === undefined) {
            return {
                type: factory.createTypeReferenceNode(NBTLongType),
                imports: [`sandstone::${NBTLongType}`],
            } as const
        } else {
            // Spyglass doesn't support BigInt, so we don't need to worry about a range that contains BigInts.
            return whole_number_generic(long.valueRange, NBTLongType)
        }
    }
}

export const McdocLong = mcdoc_long satisfies TypeHandler