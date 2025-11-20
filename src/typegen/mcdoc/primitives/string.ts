import ts from 'typescript'
import { match, P } from 'ts-pattern'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { TypeHandler } from '..'
import { Assert } from '../assert'

const { factory } = ts

const static_value = {
    normal: {
        type: factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)
    },
    not_empty: {
        type: factory.createTemplateLiteralType(
            factory.createTemplateHead('', ''),
            [
                factory.createTemplateLiteralTypeSpan(
                    factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                    factory.createTemplateMiddle('', '')
                ),
                factory.createTemplateLiteralTypeSpan(
                    factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                    factory.createTemplateTail('', '')
                )
            ]
        )
    }
} as const

function mcdoc_string(type: mcdoc.McdocType) {
    const string = type
    Assert.StringType(string)

    if (string.attributes === undefined && string.lengthRange === undefined) {
        return (...args: unknown[]) => static_value.normal
    } else if (string.attributes === undefined) {
        return (...args: unknown[]) => static_value.not_empty
    } else {
        // TODO: handle attributes
        return (...args: unknown[]) => static_value.normal
    }
}

export const McdocString = mcdoc_string satisfies TypeHandler