import * as mcdoc from '@spyglassmc/mcdoc'
import ts from 'typescript'

const { factory } = ts

export function bindImport(module_name: string, module_path: string) {
    return factory.createImportDeclaration(
        undefined,
        factory.createImportClause(
            true,
            undefined,
            factory.createNamedImports([
                factory.createImportSpecifier(false, undefined, factory.createIdentifier(module_name))
            ])
        ),
        factory.createStringLiteral(module_path, true)
    )
}

export function bindNumericLiteral(literal: number) {
    if (Math.sign(literal) === -1) {
        return factory.createPrefixUnaryExpression(
            ts.SyntaxKind.MinusToken,
            factory.createNumericLiteral(Math.abs(literal))
        )
    } else {
        return factory.createNumericLiteral(literal)
    }
}

export function bindDoc<N extends ts.Node>(node: N, doc?: string[] | mcdoc.McdocBaseType): N {
    let _doc: string[] = []
    if (doc === undefined) {
        return node
    }
    if (Array.isArray(doc)) {
        _doc = doc
    } else if (Object.hasOwn(doc, 'desc')) {
        // @ts-ignore
        const desc: string = doc.desc

        // y e s
        _doc = desc.trim().replaceAll('\n\n\n\n ', '@@bad@@').replaceAll('\n\n', '\n').replaceAll('@@bad@@', '\n\n').split('\n')
    } else {
        return node
    }
    return ts.addSyntheticLeadingComment(
        node,
        ts.SyntaxKind.MultiLineCommentTrivia,
        `*\n * ${_doc.join('\n * ')}\n `, 
        true, 
    )
}