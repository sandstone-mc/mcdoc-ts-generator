import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import { TypeHandlers, type NonEmptyList, type TypeHandler } from '..'
import { Assert } from '../assert'
import { merge_imports } from '../utils'
import { add } from '../../../util'

const { factory } = ts

const Never = factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)

function mcdoc_union(type: mcdoc.McdocType) {
    const union = type
    Assert.UnionType(union)

    return (args: Record<string, unknown>) => {
        args.root_type = false
        let imports = undefined 

        const members: ts.TypeNode[] = []

        let has_docs = false

        const member_docs = [] as unknown as NonEmptyList<false | NonEmptyList<string | [string]>>

        let child_dispatcher: NonEmptyList<[number, string]> | undefined

        for (const member of union.members) {
            let unsupported = false
            if (member.attributes !== undefined) {
                Assert.Attributes(member.attributes, true)

                const attributes = member.attributes

                for (const attribute of attributes) {
                    if (attribute.name === 'until' || attribute.name === 'deprecated') {
                        unsupported = true
                        break
                    }
                }
            }
            if (unsupported) {
                continue
            }
            const value = TypeHandlers[member.kind](member)(args)

            if ('imports' in value) {
                imports = merge_imports(imports, value.imports)
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
            }) : undefined
        ) as unknown as undefined | NonEmptyList<string | [string]>

        const result_type = members.length === 1 ? members[0] : factory.createParenthesizedType(
            factory.createUnionTypeNode(members)
        )

        // Propagate non-indexable marker if any member has it
        if (members.some(m => '--mcdoc_has_non_indexable' in m)) {
            Object.assign(result_type, { '--mcdoc_has_non_indexable': true })
        }

        return {
            type: result_type,
            ...add({imports, child_dispatcher, docs})
        } as const
    }
}

export const McdocUnion = mcdoc_union satisfies TypeHandler