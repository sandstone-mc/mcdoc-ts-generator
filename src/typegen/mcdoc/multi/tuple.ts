import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import { TypeHandlers, type NonEmptyList, type TypeHandler } from '..'
import { Assert } from '../assert'
import { merge_imports } from '../utils'

const { factory } = ts

function mcdoc_tuple(type: mcdoc.McdocType) {
    const tuple = type
    Assert.TupleType(tuple)

    return (...args: unknown[]) => {
        let has_imports = false
        const imports = {
            ordered: [] as unknown as NonEmptyList<string>,
            check: new Map<string, number>(),
        } as const

        const members: ts.TypeNode[] = []

        for (const item of tuple.items) {
            if (item.attributes?.indexOf((attr: mcdoc.Attribute) => attr.name === 'until') !== -1) {
                continue
            }

            const value = TypeHandlers[item.kind](item)([...args])

            if ('imports' in value) {
                has_imports = true
                merge_imports(imports, value.imports)
            }
            members.push(value.type)
        }

        return {
            type: factory.createTupleTypeNode(members),
            ...(has_imports ? { imports } : {})
        } as const
    }
}

export const McdocTuple = mcdoc_tuple satisfies TypeHandler