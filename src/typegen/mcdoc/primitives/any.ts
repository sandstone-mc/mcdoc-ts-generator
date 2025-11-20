import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { TypeHandler } from '..'
import { Assert } from '../assert'

const { factory } = ts

const static_value = {
    type: factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)
} as const

function mcdoc_any(type: mcdoc.McdocType) {
    const any = type
    Assert.KeywordType<'any'>(any)

    return (...args: unknown[]) => static_value
}

export const McdocAny = mcdoc_any satisfies TypeHandler