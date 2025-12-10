import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler } from '..'
import { Assert } from '../assert'

const { factory } = ts

function ReferenceArgs(args: Record<string, unknown>): asserts args is ({
    generic_types?: ts.TypeNode[]
    generics?: Set<string>
}) {}

function mcdoc_reference(type: mcdoc.McdocType) {
    const reference = type
    Assert.ReferenceType(reference)

    return (args: Record<string, unknown>) => {
        ReferenceArgs(args)

        const type_name = reference.path.slice(reference.path.lastIndexOf(':') + 1)

        const imports = {
            ordered: [reference.path] as NonEmptyList<string>,
            check: new Map([[reference.path, 0]]) as Map<string, number>,
        } as const

        if ('generic_types' in args) {
            return {
                type: factory.createTypeReferenceNode(type_name, args.generic_types),
                imports,
            } as const
        }
        if ('generics' in args && args.generics.has(reference.path)) {
            return {
                type: factory.createTypeReferenceNode(type_name)
            } as const
        }
        return {
            type: factory.createTypeReferenceNode(type_name),
            imports,
        } as const
    }
}

export const McdocReference = mcdoc_reference satisfies TypeHandler