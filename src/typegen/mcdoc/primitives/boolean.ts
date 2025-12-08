import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { TypeHandler } from '..'
import { Assert } from '../assert'

const { factory } = ts

const static_value = {
    type: factory.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword)
} as const

function mcdoc_boolean(type: mcdoc.McdocType) {
    const boolean = type
    Assert.KeywordType<'boolean'>(boolean)

    return (args: Record<string, unknown>) => static_value
}

export const McdocBoolean = mcdoc_boolean satisfies TypeHandler