import type { SymbolMap } from '@spyglassmc/core'
import * as mcdoc from '@spyglassmc/mcdoc'
import ts from 'typescript'
import { camel_case, join, pascal_case } from '../util'
import { get_type_handler, type TypeHandlerResult } from './mcdoc'
import { merge_imports, remove_imports, Set } from './mcdoc/utils'
import { Bind } from './mcdoc/bind'

/**
 * Help:
 * - https://ts-ast-viewer.com/
 * - https://stackoverflow.com/questions/67575784/typescript-ast-factory-how-to-use-comments
 */
const { factory } = ts

type NonEmptyList<T> = T[] & { 0: T }

type ResolvedModule = {
    readonly file: string,
    readonly paths: Set<string>,
    readonly imports?: NonNullable<TypeHandlerResult['imports']>
    readonly types: (ts.TypeAliasDeclaration | ts.EnumDeclaration)[]
}

export class TypesGenerator {
    private readonly resolved_modules = new Map<string, ResolvedModule>()

    readonly resolved_dispatchers = new Set<string>()

    constructor() {}

    resolve_registry_symbols(registries: SymbolMap) {}

    /**
     * Run this first
     * TODO: Reverse DispatcherReferenceCounter, I'm gonna use vanilla-mcdoc's file structure and have automated exports
     */
    resolve_module_symbols(module_members: SymbolMap) {
        for (const [_path, module_member] of Object.entries(module_members)) {
            if (!_path.endsWith('>') && module_member.data !== null && typeof module_member.data === 'object' && 'typeDef' in module_member.data) {
                const type = module_member.data.typeDef as mcdoc.McdocType
                const path = _path.split('::')
                const name = path.at(-1)!
                const module_path = path.slice(0, -1).join('::')

                const resolved_member = get_type_handler(type)(type)({ named: name })

                const module = (() => {
                    let paths = new Set([_path])
                    if (!this.resolved_modules.has(module_path)) {
                        // TODO: Only use remove_imports for dispatchers, this is silly, pass the module path through args and check in `reference`
                        remove_imports(resolved_member.imports, paths)
                        return this.resolved_modules.set(module_path, {
                            file: this.path_to_file(path.slice(0, -1)),
                            paths,
                            types: [],
                            ...('imports' in resolved_member ? { imports: resolved_member.imports } : {})
                        }).get(module_path)!
                    }
                    const mod = this.resolved_modules.get(module_path)!

                    paths = mod.paths.add(_path)

                    if ('imports' in resolved_member) {
                        if ('imports' in mod) {
                            merge_imports(mod.imports, resolved_member.imports)
                        } else {
                            // @ts-ignore
                            mod.imports = resolved_member.imports
                        }
                    }
                    remove_imports(resolved_member.imports, paths)
                    return mod
                })()

                if (type.kind === 'enum' || type.kind === 'template') {
                    module.types.push(resolved_member.type as (ts.EnumDeclaration | ts.TypeAliasDeclaration))
                } else {
                    module.types.push(Bind.BindDoc(factory.createTypeAliasDeclaration(
                        [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
                        name,
                        undefined,
                        resolved_member.type as ts.TypeNode
                    ), resolved_member.docs))
                }
            }
        }
    }

    resolve_dispatcher_symbols(dispatchers: SymbolMap) {
    }

    path_to_file(path: string[]) {
        // TODO
        return path[0]
    }
}