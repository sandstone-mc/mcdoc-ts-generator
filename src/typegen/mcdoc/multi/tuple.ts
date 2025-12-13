import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import { TypeHandlers, type NonEmptyList, type TypeHandler, type TypeHandlerResult } from '..'
import { Assert } from '../assert'
import { merge_imports } from '../utils'
import { add } from '../../../util'

const { factory } = ts

function mcdoc_tuple(type: mcdoc.McdocType) {
    const tuple = type
    Assert.TupleType(tuple)

    return (args: Record<string, unknown>) => {
        args.root_type = false
        let imports = undefined as unknown as TypeHandlerResult['imports']

        const members: ts.TypeNode[] = []

        let has_docs = false
        
        const member_docs = [] as unknown as NonEmptyList<false | NonEmptyList<string | [string]>>

        let child_dispatcher: NonEmptyList<[parent_count: number, property: string]> | undefined

        for (const item of tuple.items) {
            if (item.attributes?.indexOf((attr: mcdoc.Attribute) => attr.name === 'until') !== -1) {
                continue
            }

            const value = TypeHandlers[item.kind](item)(args)

            if ('imports' in value) {
                merge_imports(imports, value.imports)
            }
            if ('child_dispatcher' in value) {
                if (child_dispatcher === undefined) {
                    child_dispatcher = [] as unknown as typeof child_dispatcher
                }
                child_dispatcher!.push(...((value.child_dispatcher as NonEmptyList<[number, string]>).map(([parent_count, property]) => {
                    if (parent_count === 0) {
                        throw new Error(`[mcdoc_tuple] Tuple contains a dynamic dispatcher with invalid parenting: ${item}`)
                    }
                    return [parent_count - 1, property]
                }) as NonEmptyList<[number, string]>))
            }
            if ('docs' in value) {
                has_docs = true
                const docs: NonEmptyList<string | [string]> = value.docs
                member_docs.push(value.docs)
            } else {
                member_docs.push(false)
            }
            members.push(value.type)
        }

        const docs = (
            has_docs ? member_docs.flatMap((doc, i) => {
                if (members.length === 1 && doc !== false) {
                    return [doc]
                } else {
                    return [
                        ...(doc === false ? [ `*item ${i}*` ] : [doc]),
                        ...(i !== (member_docs.length - 1) ? [ '', '*or*', '' ] : [])
                    ]
                }
            }) : undefined
        ) as unknown as undefined | NonEmptyList<string | [string]>

        return {
            type: factory.createTupleTypeNode(members),
            ...add({imports, child_dispatcher, docs}),
        } as const
    }
}

export const McdocTuple = mcdoc_tuple satisfies TypeHandler