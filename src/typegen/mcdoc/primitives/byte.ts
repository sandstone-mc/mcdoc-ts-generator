import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { TypeHandler } from '..'
import { Assert } from '../assert'
import { whole_number_generic } from './int'

const { factory } = ts

const NBTByteType = 'NBTByte'

function mcdoc_byte(type: mcdoc.McdocType) {
    const byte = type
    Assert.NumericType<'byte'>(byte)

    return (...args: unknown[]) => {
        if (byte.valueRange === undefined) {
            return {
                type: factory.createTypeReferenceNode(NBTByteType),
                imports: [`sandstone::${NBTByteType}`],
            } as const
        } else {
            return whole_number_generic(byte.valueRange, NBTByteType)
        }
    }
}

export const McdocByte = mcdoc_byte satisfies TypeHandler