import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import { TypeHandlers, type NonEmptyList, type TypeHandler } from '..'
import { Assert } from '../assert'
import { merge_imports } from '../utils'

const { factory } = ts

const Never = factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)

function mcdoc_union(type: mcdoc.McdocType) {
    const union = type
    Assert.UnionType(union)

    return (args: Record<string, unknown>) => {
        let has_imports = false
        const imports = {
            ordered: [] as unknown as NonEmptyList<string>,
            check: new Map<string, number>(),
        } as const

        const members: ts.TypeNode[] = []

        let child_dispatcher: NonEmptyList<[number, string]> | undefined

        for (const member of union.members) {
            if (member.attributes?.indexOf((attr: mcdoc.Attribute) => attr.name === 'until') !== -1) {
                continue
            }
            const value = TypeHandlers[member.kind](member)(args)

            if ('imports' in value) {
                has_imports = true
                merge_imports(imports, value.imports)
            }
            if ('child_dispatcher' in value) {
                if (child_dispatcher === undefined) {
                    child_dispatcher = [] as unknown as typeof child_dispatcher
                }
                child_dispatcher!.push(...(value.child_dispatcher as NonEmptyList<[number, string]>))
            }
            members.push(value.type)
        }

        if (members.length === 0) {
            members.push(Never)
        }

        return {
            type: members.length === 1 ? members[0] : factory.createParenthesizedType(
                factory.createUnionTypeNode(members)
            ),
            ...(has_imports ? { imports } : {}),
            ...(child_dispatcher === undefined ? {} : { child_dispatcher }),
        } as const
    }
}

export const McdocUnion = mcdoc_union satisfies TypeHandler