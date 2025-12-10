import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler } from '..'
import { Assert } from '../assert'
import type { DispatcherReferenceCounter } from '../../symbols/dispatcher'

const { factory } = ts

function ReferenceArgs(args: Record<string, unknown>): asserts args is ({
    generic_types?: ts.TypeNode[]
    generics?: Set<string>
    dispatcher_symbol?: () => DispatcherReferenceCounter
}) {}

function mcdoc_reference(type: mcdoc.McdocType) {
    const reference = type
    Assert.ReferenceType(reference)

    return (args: Record<string, unknown>) => {
        ReferenceArgs(args)

        const type_name_point = reference.path.lastIndexOf(':')
        const type_name = reference.path.slice(type_name_point + 1)

        if ('dispatcher_symbol' in args) {
            const base_path = reference.path.slice(0, type_name_point - 2)
            const dispatcher = args.dispatcher_symbol()
            const location_counts_index = dispatcher.locations.get(base_path)

            if (location_counts_index === undefined) {
                dispatcher.locations.set(base_path, dispatcher.location_counts.length)
                dispatcher.location_counts.push([base_path, 1])
            } else {
                dispatcher.location_counts[location_counts_index][1]++
            }
        }

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