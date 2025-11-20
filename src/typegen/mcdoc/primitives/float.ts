import * as mcdoc from '@spyglassmc/mcdoc'
import ts from 'typescript'
import { Assert } from '../assert'
import { Bind } from '../bind'
import type { TypeHandler } from '..'
import { non_integral_generic } from './double'

const { factory } = ts

const NBTFloatType = 'NBTFloat'

function mcdoc_float(type: mcdoc.McdocType) {
    const float = type
    Assert.NumericType<'float'>(float)

    return (...args: unknown[]) => {
        if (float.valueRange === undefined) {
            return {
                type: factory.createTypeReferenceNode(NBTFloatType),
                imports: [`sandstone::${NBTFloatType}`],
            } as const
        } else {
            return non_integral_generic(float.valueRange, NBTFloatType)
        }
    }
}

export const McdocFloat = mcdoc_float satisfies TypeHandler