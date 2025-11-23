import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler } from '..'
import { Assert } from '../assert'

const { factory } = ts

function mcdoc_reference(type: mcdoc.McdocType) {
    const reference = type
    Assert.ReferenceType(reference)

    return (...args: unknown[]) => {
        return {
            type: factory.createTypeReferenceNode(reference.path.slice(reference.path.lastIndexOf(':') + 1)),
            imports: {
                ordered: [reference.path] as NonEmptyList<string>,
                check: new Map([[reference.path, 0]]) as Map<string, number>,
            },
        } as const
    }
}

export const McdocReference = mcdoc_reference satisfies TypeHandler