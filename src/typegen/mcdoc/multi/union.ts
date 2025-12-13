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
        args.root_type = false
        let has_imports = false
        const imports = {
            ordered: [] as unknown as NonEmptyList<string>,
            check: new Map<string, number>(),
        } as const

        const members: ts.TypeNode[] = []

        let has_docs = false

        const member_docs = [] as unknown as NonEmptyList<false | NonEmptyList<string | [string]>>

        let child_dispatcher: NonEmptyList<[number, string]> | undefined

        for (const member of union.members) {
            if (member.attributes !== undefined && member.attributes.indexOf((attr: mcdoc.Attribute) => attr.name === 'until') !== -1) {
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
            if ('docs' in value) {
                has_docs = true
                member_docs.push(value.docs)
            } else {
                member_docs.push(false)
            }
            members.push(value.type)
        }

        if (members.length === 0) {
            if (union.members.length !== 0) {
                console.log(union.members)
            }
            members.push(Never)
        }

        const docs = (
            has_docs ? member_docs.flatMap((doc, i) => {
                if (members.length === 1 && doc !== false) {
                    return doc
                } else {
                    return [
                        ...(i === 0 ? [ '*either*', '' ] : []),
                        (doc === false ? [ `*item ${i}*` ] : doc),
                        ...(i !== (member_docs.length - 1) ? [ '', '*or*', '' ] : [])
                    ]
                }
            }) : []
        ) as unknown as NonEmptyList<string | [string]>

        return {
            type: members.length === 1 ? members[0] : factory.createParenthesizedType(
                factory.createUnionTypeNode(members)
            ),
            ...(has_imports ? { imports } : {}),
            ...(child_dispatcher === undefined ? {} : { child_dispatcher }),
            ...(has_docs ? { docs } : {}),
        } as const
    }
}

export const McdocUnion = mcdoc_union satisfies TypeHandler