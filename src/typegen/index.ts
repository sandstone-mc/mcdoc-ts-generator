import type { Service, SymbolMap } from '@spyglassmc/core'
import * as mcdoc from '@spyglassmc/mcdoc'
import ts from 'typescript'

const { factory } = ts

export class TypesGenerator {
    constructor(private service: Service, private symbols: SymbolMap, private dispatchers: SymbolMap) {}

    resolveRootTypes(export_name: string, typeDef: mcdoc.McdocType) {
        if (typeDef.kind === 'struct') {
            const result = this.createStruct(typeDef)
    
            const types = [factory.createTypeAliasDeclaration(
                [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
                factory.createIdentifier(export_name),
                undefined,
                result.type,
            )] as (ts.TypeAliasDeclaration | ts.ImportDeclaration | ts.EnumDeclaration)[]
    
            if (result.modules.length > 0) {
                types.push(...result.modules)
            }
    
            if (result.imports.length > 0) {
                types.unshift(...result.imports)
            }
            
            return types
        } else {
            return []
        }
    }

    createStruct(typeDef: mcdoc.StructType, parent?: mcdoc.StructType) {
        const anyFallback = ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)

        const member_types: (ts.IndexSignatureDeclaration | ts.PropertySignature | ts.Identifier)[] = []

        const imports: ts.ImportDeclaration[] = []
        
        const modules: (ts.TypeAliasDeclaration | ts.EnumDeclaration)[] = []

        for (const field of typeDef.fields) {
            if (field.attributes !== undefined && field.attributes.includes((attr: mcdoc.Attribute) => attr.name === 'until')) {
                continue
            }

            if (field.kind === 'pair') {
                let key: (value: ts.TypeNode) => ts.PropertySignature | ts.IndexSignatureDeclaration
                let value: ts.TypeNode = anyFallback

                if (typeof field.key === 'string') {
                    key = (value: ts.TypeNode) => factory.createPropertySignature(
                        undefined,
                        this.bindKey(field.key),
                        undefined,
                        value
                    )
                } else if (field.key.kind === 'string') {
                    if (field.key.attributes && field.key.attributes.includes((attr: mcdoc.Attribute) => attr.name === 'id')) {
                        if (field.type.kind === 'struct') {
                            const struct = this.createStruct(field.type, typeDef)

                            key = (value: ts.TypeNode) => factory.createIndexSignature(
                                undefined,
                                [
                                    factory.createParameterDeclaration(
                                        undefined,
                                        undefined,
                                        factory.createIdentifier('id'),
                                        undefined,
                                        factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                                    )
                                ],
                                value,
                            )

                            if (struct.imports.length > 0) {
                                imports.push(...struct.imports)
                            }
                            if (struct.modules.length > 0) {
                                modules.push(...struct.modules)
                            }
                        }
                    } else {
                        let index = (value: ts.TypeNode) => ts.factory.createIndexSignature(
                            undefined,
                            [
                                ts.factory.createParameterDeclaration(
                                    undefined,
                                    undefined,
                                    ts.factory.createIdentifier('key'),
                                    undefined,
                                    ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                                )
                            ],
                            value,
                        )

                        
                    }
                }

                /* @ts-ignore */
                if (key !== undefined) {
                    member_types.push(key(value))
                }
            } else {

            }
        }
    }

    bindKey(key: string | mcdoc.McdocType) {
        if (typeof key === 'string') return ts.factory.createIdentifier(key)
    
        return ts.factory.createComputedPropertyName(ts.factory.createIdentifier('string'))
    }
}