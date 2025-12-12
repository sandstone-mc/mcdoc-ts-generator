import { AllCategories, type SymbolMap, type SymbolUtil } from '@spyglassmc/core'
import * as mcdoc from '@spyglassmc/mcdoc'
import ts from 'typescript'
import { pascal_case, pluralize } from '../util'
import { get_type_handler, type TypeHandlerResult } from './mcdoc'
import { add_import, merge_imports, Set, type NonEmptyList } from './mcdoc/utils'
import { Bind } from './mcdoc/bind'
import { DispatcherSymbol } from './mcdoc/dispatcher_symbol'

/**
 * Help: https://ts-ast-viewer.com/
 */
const { factory } = ts

type ResolvedSymbol = {
    readonly paths: Set<string>
    readonly imports?: NonNullable<TypeHandlerResult['imports']>
    readonly exports: (ts.TypeAliasDeclaration | ts.EnumDeclaration | ts.VariableStatement)[]
}

type ResolvedRegistry = {
    symbol_path: string,
    registry: ts.Identifier
}

type ResolvedDispatcher = {
    symbol_path: string,
    type: ts.TypeReference
}

export class TypesGenerator {
    readonly resolved_registries = new Map<string, ResolvedRegistry>()

    readonly dispatcher_properties = new Map<string, { supports_none?: true }>

    readonly resolved_symbols = new Map<string, ResolvedSymbol>()

    readonly resolved_dispatchers = new Map<string, ResolvedDispatcher>()

    constructor() {}

    resolve_types(symbols: SymbolUtil) {
        console.log('registries')
        this.resolve_registry_symbols(symbols)

        const dispatchers = symbols.getVisibleSymbols('mcdoc/dispatcher')

        for (const id of Object.keys(dispatchers)) {
            if ('%none' in dispatchers[id].members!) {
                this.dispatcher_properties.set(id, { supports_none: true })
            }
        }

        console.log('modules')
        this.resolve_module_symbols(symbols.getVisibleSymbols('mcdoc'))

        console.log('dispatchers')
        this.resolve_dispatcher_symbols(dispatchers)
    }

    private resolve_registry_symbols(registries: SymbolUtil) {
        for (const registry_name of AllCategories) {
            if (registry_name === 'mcdoc' || registry_name === 'mcdoc/dispatcher') {
                continue
            }

            const registry = Object.keys(registries.getVisibleSymbols(registry_name))

            if (registry.length === 0) continue

            const type_name = pluralize(registry_name.split('/').join('_')).toUpperCase()
            const symbol_path = `java::_registry::${registry_name}`

            this.resolved_symbols.set(
                symbol_path,
                {
                    imports: {
                        check: new Map(),
                        ordered: ['sandstone::Set'] as const,
                    },
                    exports: [factory.createVariableStatement(
                        [factory.createToken(ts.SyntaxKind.ExportKeyword)],
                        factory.createVariableDeclarationList(
                            [factory.createVariableDeclaration(
                                type_name,
                                undefined,
                                undefined,
                                factory.createNewExpression(
                                    factory.createIdentifier('Set'),
                                    undefined,
                                    [factory.createAsExpression(
                                        factory.createArrayLiteralExpression(
                                            registry.map((s) => factory.createStringLiteral(s, true)),
                                            true
                                        ),
                                        factory.createTypeReferenceNode('const')
                                    )]
                                )
                            )],
                            ts.NodeFlags.Const | ts.NodeFlags.Constant | ts.NodeFlags.Constant
                        )
                    )],
                    paths: new Set()
                }
            )

            this.resolved_registries.set(registry_name, {
                registry: factory.createIdentifier(type_name),
                symbol_path,
            })
        }
    }

    private resolve_module_symbols(module_members: SymbolMap) {
        for (const _path of Object.keys(module_members)) {
            const { data } = module_members[_path]

            if (!_path.endsWith('>') && data !== null && typeof data === 'object' && 'typeDef' in data) {
                const type = data.typeDef as mcdoc.McdocType
                const path = _path.split('::')
                if (typeof path === 'string') {
                    throw new Error('wtf')
                }
                const name = path.at(-1)!
                const module_path = path.slice(0, -1).join('::')

                const resolved_member = get_type_handler(type)(type)({
                    dispatcher_properties: this.dispatcher_properties,
                    name,
                    module_path,
                })

                const module = (() => {
                    if (!this.resolved_symbols.has(module_path)) {
                        return this.resolved_symbols.set(module_path, {
                            paths: new Set([_path]),
                            exports: [],
                            ...('imports' in resolved_member ? { imports: resolved_member.imports } : {})
                        }).get(module_path)!
                    }
                    const mod = this.resolved_symbols.get(module_path)!

                    mod.paths.add(_path)

                    if ('imports' in resolved_member) {
                        if ('imports' in mod) {
                            merge_imports(mod.imports, resolved_member.imports)
                        } else {
                            // @ts-ignore
                            mod.imports = resolved_member.imports
                        }
                    }
                    return mod
                })()

                if (type.kind === 'enum' || type.kind === 'template') {
                    module.exports.push(resolved_member.type as (ts.EnumDeclaration | ts.TypeAliasDeclaration))
                } else {
                    module.exports.push(Bind.BindDoc(factory.createTypeAliasDeclaration(
                        [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
                        name,
                        undefined,
                        resolved_member.type as ts.TypeNode
                    ), resolved_member.docs))
                }
            }
        }
    }

    private resolve_dispatcher_symbols(dispatchers: SymbolMap) {
        for (const id of Object.keys(dispatchers)) {
            const { members } = dispatchers[id]
            if (members === undefined) {
                continue
            }
            const [ namespace, _name ] = id.split(':')
            const name = pascal_case(_name)

            // Once/if the dispatcher symbol map gets declaration paths we can switch to that instead of `references`
            const { types, imports, references } = DispatcherSymbol(id, name, members, this.dispatcher_properties)

            let in_module = false

            const symbol_path = (() => {
                if (namespace === 'mcdoc') {
                    return `java::_builtin::${_name}`
                }
                if (references !== undefined) {
                    const sorted = references.location_counts.sort((a, b) => b[1] - a[1])

                    if (sorted.length === 1 || (sorted[0][1] > (sorted[1][1] + 5))) {
                        in_module = true
                        return sorted[0][0]
                    }
                }
                return `java::_dispatcher::${_name}`
            })()

            if (in_module && this.resolved_symbols.has(symbol_path)) {
                const mod = this.resolved_symbols.get(symbol_path)!

                mod.exports.push(...types)

                if (imports !== undefined) {
                    if (!('imports' in mod)) {
                        // @ts-ignore
                        mod.imports = {
                            ordered: [] as unknown as NonEmptyList<string>,
                            check: new Map<string, number>(),
                        } as const
                    }
                    // Once/if the dispatcher symbol map gets declaration paths we can use `merge_imports` 
                    for (const path of imports.ordered) {
                        if (!mod.paths.has(path) && !mod.imports!.check.has(path)) {
                            add_import(mod.imports!, path)
                        }
                    }
                }
            } else {
                this.resolved_symbols.set(symbol_path, {
                    exports: types,
                    paths: new Set(),
                    ...(imports === undefined ? {} : { imports })
                })
            }
        }
    }
}