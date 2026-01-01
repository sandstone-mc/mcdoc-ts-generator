import { AllCategories, type SymbolMap, type SymbolUtil } from '@spyglassmc/core'
import * as mcdoc from '@spyglassmc/mcdoc'
import ts from 'typescript'
import { add, pascal_case, pluralize } from '../util'
import { get_type_handler, type TypeHandlerResult } from './mcdoc'
import { merge_imports, Set } from './mcdoc/utils'
import { Bind } from './mcdoc/bind'
import { DispatcherSymbol, dispatcher_symbol_paths } from './mcdoc/dispatcher_symbol'
import { mcdoc_raw } from '..'
import { export_dispatchers, export_registry } from './export'

/**
 * Help: https://ts-ast-viewer.com/
 */
const { factory } = ts

export type ResolvedSymbol = {
    readonly paths: Set<string>
    readonly imports?: NonNullable<TypeHandlerResult['imports']>
    readonly exports: (ts.TypeAliasDeclaration | ts.EnumDeclaration | ts.VariableStatement)[]
}

export type ResolvedRegistry = {
    import_path: string,
    registry: ts.Identifier
}

export type ResolvedDispatcher = {
    import_path: string,
    type: ts.TypeReferenceNode,
    /**
     * Number of required generic parameters (excluding CASE)
     */
    generic_count: number,
    /**
     * The symbol type name (e.g., "SymbolDataComponent")
     */
    symbol_name: string
}

/**
 * Pre-computed dispatcher info for use during type resolution.
 * Maps dispatcher ID (e.g., 'minecraft:entity_effect') to symbol info.
 */
export type DispatcherInfo = {
    /** The symbol type name (e.g., "SymbolEntityEffect") */
    symbol_name: string
    /** Number of generic parameters (excluding CASE) */
    generic_count: number
    /** Whether this dispatcher has a %unknown member (exports FallbackType) */
    has_fallback_type: boolean
}

export class TypesGenerator {
    readonly resolved_registries = new Map<string, ResolvedRegistry>()

    readonly dispatcher_properties = new Map<string, { supports_none?: true }>

    readonly resolved_symbols = new Map<string, ResolvedSymbol>()

    readonly resolved_dispatchers = new Map<string, ResolvedDispatcher>()

    /** Pre-computed dispatcher info for use during type resolution */
    readonly dispatcher_info = new Map<string, DispatcherInfo>()

    constructor() {}

    resolve_types(symbols: SymbolUtil, translation_keys: string[]) {
        console.log('registries')
        this.resolve_registry_symbols(symbols, translation_keys)
        const registry_exports = export_registry(this.resolved_registries)
        this.resolved_symbols.set('::java::registry', registry_exports)

        const dispatchers = symbols.getVisibleSymbols('mcdoc/dispatcher')

        // Pre-compute dispatcher info before resolving modules
        console.log('dispatcher info')
        this.precompute_dispatcher_info(dispatchers)

        console.log('modules')
        const module_map = symbols.getVisibleSymbols('mcdoc')
        this.resolve_module_symbols(module_map, symbols)

        console.log('dispatchers')
        this.resolve_dispatcher_symbols(dispatchers, module_map, symbols)

        const dispatcher_exports = export_dispatchers(dispatcher_symbol_paths)
        this.resolved_symbols.set('::java::dispatcher', dispatcher_exports)
    }

    /**
     * Pre-computes dispatcher info (symbol names and import paths) before module resolution.
     * This allows modules to directly reference SymbolX types instead of the central Dispatcher type.
     *
     * Also populates dispatcher_properties with supports_none info.
     *
     * Note: All dispatchers are placed in _dispatcher/ (or _builtin/ for mcdoc namespace) for predictability.
     */
    private precompute_dispatcher_info(dispatchers: SymbolMap) {
        type DispatcherMember = { typeDef: mcdoc.McdocType }

        for (const id of Object.keys(dispatchers)) {
            const { members } = dispatchers[id]
            if (members === undefined) {
                continue
            }

            // Populate dispatcher_properties with supports_none info
            if ('%none' in members) {
                this.dispatcher_properties.set(id, { supports_none: true })
            }

            const [namespace, _name] = id.split(':')
            const name = pascal_case(`${namespace === 'mcdoc' ? 'mcdoc_' : ''}${_name}`)
            const symbol_name = `Symbol${name}`

            // Determine generic count by checking if first member is a template type
            const first_member_key = Object.keys(members).find(k => !k.startsWith('%'))
            let generic_count = 0

            if (first_member_key) {
                const first_type = (members[first_member_key].data as DispatcherMember).typeDef
                if (first_type.kind === 'template') {
                    generic_count = first_type.typeParams.length
                }
            }

            this.dispatcher_info.set(id, {
                symbol_name,
                generic_count,
                has_fallback_type: '%unknown' in members
            })
        }
    }

    private resolve_registry_symbols(registries: SymbolUtil, translation_keys: string[]) {
        for (const registry_name of [...AllCategories]) {
            if (registry_name === 'mcdoc' || registry_name === 'mcdoc/dispatcher') {
                continue
            }

            const registry = registry_name === 'translation_key' ? translation_keys : Object.keys(registries.getVisibleSymbols(registry_name))

            if (registry.length === 0) continue

            const type_name = pluralize(registry_name.split('/').join('_')).toUpperCase()
            const symbol_path = `::java::_registry::${type_name.toLowerCase()}`

            this.resolved_symbols.set(
                symbol_path,
                {
                    imports: {
                        check: new Map(),
                        ordered: ['sandstone::NamespacedLiteralUnion', 'sandstone::Set', 'sandstone::SetType'] as const,
                    },
                    exports: [
                        factory.createTypeAliasDeclaration(
                            [factory.createToken(ts.SyntaxKind.ExportKeyword)],
                            type_name,
                            undefined,
                            factory.createParenthesizedType(factory.createUnionTypeNode([
                                factory.createTypeReferenceNode(
                                    'NamespacedLiteralUnion',
                                    [factory.createTypeReferenceNode(
                                        factory.createIdentifier('SetType'),
                                        [factory.createTypeQueryNode(factory.createIdentifier(`${type_name}_SET`))]
                                    )]
                                ),
                                factory.createTemplateLiteralType(
                                    factory.createTemplateHead('minecraft:'),
                                    [factory.createTemplateLiteralTypeSpan(
                                        factory.createTypeReferenceNode(
                                            factory.createIdentifier('SetType'),
                                            [factory.createTypeQueryNode(factory.createIdentifier(`${type_name}_SET`))]
                                        ),
                                        factory.createTemplateTail('')
                                    )]
                                )
                            ])),
                        ),
                        factory.createVariableStatement(
                            [factory.createToken(ts.SyntaxKind.ExportKeyword)],
                            factory.createVariableDeclarationList(
                                [factory.createVariableDeclaration(
                                    `${type_name}_SET`,
                                    undefined,
                                    undefined,
                                    factory.createNewExpression(
                                        factory.createIdentifier('Set'),
                                        undefined,
                                        [factory.createAsExpression(
                                            factory.createArrayLiteralExpression(
                                                registry.map((s) => factory.createStringLiteral(s.split(':')[1], true)),
                                                true
                                            ),
                                            factory.createTypeReferenceNode('const')
                                        )]
                                    )
                                )],
                                ts.NodeFlags.Const
                            )
                        ),
                    ],
                    paths: new Set()
                }
            )

            this.resolved_registries.set(registry_name, {
                registry: factory.createIdentifier(type_name),
                import_path: `${symbol_path}::${type_name}`,
            })
        }
    }

    private resolve_module_symbols(module_map: SymbolMap, symbols: SymbolUtil) {
        for (const _path of Object.keys(module_map)) {
            const { data } = module_map[_path]

            // These are unnamed nested structs that really shouldn't be in the symbol table at all
            if (_path.endsWith('>')) {
                continue
            }
            if (!_path.endsWith('::StructureNBT')) {
                // If a full symbol path only shows up in the AST once, it is always a duplicate of a nested struct which is unreached by any of our exported types. The reason these exist in the AST is as a hack for locales.
                const matches = mcdoc_raw.matchAll(new RegExp(_path, 'g'))
                const first_match = matches.next()
                const second_match = matches.next()

                if (!first_match.done && second_match.done) {
                    continue
                }
            }

            if (data !== null && typeof data === 'object' && 'typeDef' in data) {
                const type = data.typeDef as mcdoc.McdocType
                const path = _path.split('::')
                const name = path.at(-1)!
                const module_path = path.slice(0, -1).join('::')

                // Skip root type references without attributes.
                // These are import-to-export type aliases (e.g., `type X = X` where X is imported)
                // that cause TS2440 conflicts and break enum doc propagation.
                if (type.kind === 'reference') {
                    const has_attrs = 'attributes' in type && Array.isArray(type.attributes) && type.attributes.length > 0
                    if (!has_attrs) {
                        continue
                    }
                }

                const resolved_member = get_type_handler(type)(type)({
                    dispatcher_properties: this.dispatcher_properties,
                    dispatcher_info: this.dispatcher_info,
                    root_type: true,
                    name,
                    module_path,
                    module_map,
                    symbols,
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
                        // @ts-ignore
                        mod.imports = merge_imports(mod.imports, resolved_member.imports)
                    }
                    return mod
                })()

                if (ts.isTypeAliasDeclaration(resolved_member.type)) {
                    module.exports.push(resolved_member.type)
                } else {
                    module.exports.push(Bind.Doc(factory.createTypeAliasDeclaration(
                        [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
                        name,
                        undefined,
                        resolved_member.type as ts.TypeNode
                    ), resolved_member.docs))
                }
            }
        }
    }

    private resolve_dispatcher_symbols(dispatchers: SymbolMap, module_map: SymbolMap, symbols: SymbolUtil) {
        for (const id of Object.keys(dispatchers)) {
            const { members } = dispatchers[id]
            if (members === undefined) {
                continue
            }
            const [ namespace, _name ] = id.split(':')
            const name = pascal_case(`${namespace === 'mcdoc' ? 'mcdoc_' : ''}${_name}`)

            // Once/if the dispatcher symbol map gets declaration paths we can switch to that instead of `references`
            const { types, imports, references, generic_count } = DispatcherSymbol(id, name, members, this.dispatcher_properties, this.dispatcher_info, module_map, symbols)

            let in_module = false

            const symbol_path = (() => {
                if (namespace === 'mcdoc') {
                    return `::java::_builtin::${_name}`
                }
                if (references !== undefined) {
                    const sorted = references.location_counts.sort((a, b) => b[1] - a[1])

                    if (sorted.length === 1 || (sorted[0][1] > (sorted[1][1] + 5))) {
                        in_module = true
                        return sorted[0][0]
                    }
                }
                return `::java::_dispatcher::${_name}`
            })()

            // Track this path for dispatcher exports
            const info = this.dispatcher_info.get(id)!
            dispatcher_symbol_paths.set(symbol_path, {
                symbol_name: `Symbol${name}`,
                base_name: name,
                has_fallback_type: info.has_fallback_type
            })

            // Store dispatcher reference for the Dispatcher export type
            const dispatcher_type_name = `Symbol${name}`
            this.resolved_dispatchers.set(id, {
                import_path: `${symbol_path}::${dispatcher_type_name}`,
                type: factory.createTypeReferenceNode(dispatcher_type_name),
                generic_count,
                symbol_name: dispatcher_type_name
            })

            if (in_module && this.resolved_symbols.has(symbol_path)) {
                const mod = this.resolved_symbols.get(symbol_path)!

                mod.exports.push(...types)

                let module_has_imports = false

                if (mod.imports !== undefined) {
                    module_has_imports = true
                }

                if (imports !== undefined) {
                    // @ts-ignore
                    mod.imports = merge_imports(mod.imports, imports)

                    if (module_has_imports) {
                        // @ts-ignore
                        mod.imports.ordered = mod.imports.ordered.filter((imp) => imp !== `::java::dispatcher::Symbol${name}` && !imp.startsWith(symbol_path))
                    }
                } else if (module_has_imports) {
                    // @ts-ignore
                    mod.imports.ordered = mod.imports.ordered.filter((imp) => imp !== `::java::dispatcher::Symbol${name}` && !imp.startsWith(symbol_path))
                }
            } else {
                this.resolved_symbols.set(symbol_path, {
                    exports: types,
                    paths: new Set(),
                    ...add({imports})
                })
            }
        }
    }
}