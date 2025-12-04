import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import { TypeHandlers, type NonEmptyList, type TypeHandler } from '..'
import { Assert } from '../assert'
import { merge_imports } from '../utils'

const { factory } = ts

function mcdoc_union(type: mcdoc.McdocType) {
    const union = type
    Assert.UnionType(union)

    return (...args: unknown[]) => {
        let has_imports = false
        const imports = {
            ordered: [] as unknown as NonEmptyList<string>,
            check: new Map<string, number>(),
        } as const

        const members: ts.TypeNode[] = []

        for (const member of union.members) {
            if (member.attributes?.indexOf((attr: mcdoc.Attribute) => attr.name === 'until') !== -1) {
                continue
            }
            const value = TypeHandlers[member.kind](member)([...args])

            if ('imports' in value) {
                has_imports = true
                merge_imports(imports, value.imports)
            }
            members.push(value.type)
        }

        return {
            type: factory.createParenthesizedType(
                factory.createUnionTypeNode(members)
            ),
            ...(has_imports ? { imports } : {})
        } as const
    }
}

export const McdocUnion = mcdoc_union satisfies TypeHandler