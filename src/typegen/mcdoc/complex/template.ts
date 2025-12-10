import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import { TypeHandlers, type NonEmptyList, type TypeHandler } from '..'
import { Assert } from '../assert'
import { merge_imports } from '../utils'

const { factory } = ts

/**
 * Arguments that can be passed to the template handler.
 */
export type TemplateArgs = {
    name: string,
}

/**
 * Validates and extracts template args from the unknown TypeHandler args.
 */
function parse_template_args(args: Record<string, unknown>): TemplateArgs {
    if (!('name' in args)) {
        throw new Error(`[mcdoc_template] template name must be included in TypeHandler args, got ${args}`)
    }

    return {
        name: args.name as string
    }
}

/**
 * Handles `template` types which are generic type definitions.
 *
 * A template type has:
 * - `typeParams`: The generic definitions (e.g., `<T, U>`)
 * - `child`: The actual type definition that uses those generics
 *
 * Example mcdoc:
 * ```mcdoc
 * type Template<A, B> = struct {
 *     first: A,
 *     second: B,
 * }
 * ```
 *
 * Generates a TypeScript type alias:
 * ```ts
 * type Template<A, B> = { first: A; second: B }
 * ```
 */
function mcdoc_template(type: mcdoc.McdocType) {
    Assert.TemplateType(type)

    const original_generics = type.typeParams
    const child = type.child

    return (args: Record<string, unknown>) => {
        const { name } = parse_template_args(args)

        let has_imports = false
        const imports = {
            ordered: [] as unknown as NonEmptyList<string>,
            check: new Map<string, number>(),
        } as const

        const generic_paths = new Set<string>()
        const generics: ts.TypeParameterDeclaration[] = []

        for (const generic of original_generics) {
            generic_paths.add(generic.path)
            generics.push(factory.createTypeParameterDeclaration(
                undefined,
                generic.path.slice(generic.path.lastIndexOf(':') + 1)
            ))
        }

        // Process the child type
        const child_result = TypeHandlers[child.kind](child)({ 
            generics: generic_paths,
            ...args
        })

        if ('imports' in child_result && child_result.imports) {
            has_imports = true
            merge_imports(imports, child_result.imports)
        }

        // Create the type alias with type parameters
        const type_alias = factory.createTypeAliasDeclaration(
            [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
            name,
            generics,
            child_result.type as ts.TypeNode
        )

        return {
            type: type_alias as unknown as ts.TypeNode,
            ...(has_imports ? { imports } : {}),
            ...('child_dispatcher' in child_result && child_result.child_dispatcher !== undefined
                ? { child_dispatcher: child_result.child_dispatcher }
                : {}
            ),
        } as const
    }
}

export const McdocTemplate = mcdoc_template satisfies TypeHandler
