import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler } from '../..'
import { Assert } from '../../assert'
import { length_range_generic } from '../list'

const { factory } = ts

const NBTLongArrayType = 'NBTLongArray'
const NBTLongArrayImport = `sandstone::${NBTLongArrayType}`

function mcdoc_long_array(type: mcdoc.McdocType) {
    Assert.ArrayType<'long_array'>(type)

    return (args: Record<string, unknown>) => {
        const imports = {
            ordered: [NBTLongArrayImport] as NonEmptyList<string>,
            check: new Map<string, number>([[NBTLongArrayImport, 0]]),
        }

        if (type.lengthRange) {
            const { generic, docs } = length_range_generic(type.lengthRange, 'Array')

            return {
                type: factory.createTypeReferenceNode(NBTLongArrayType, [
                    factory.createTypeLiteralNode(generic),
                ]),
                imports,
                docs,
            } as const
        } else {
            return {
                type: factory.createTypeReferenceNode(NBTLongArrayType),
                imports,
            } as const
        }
    }
}

export const McdocLongArray = mcdoc_long_array satisfies TypeHandler
