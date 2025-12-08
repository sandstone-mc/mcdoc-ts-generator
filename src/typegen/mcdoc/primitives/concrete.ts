import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import { TypeHandlers, type NonEmptyList, type TypeHandler } from '..'
import { Assert } from '../assert'
import { merge_imports } from '../utils'

const { factory } = ts

/**
 * Handles `concrete` types which are type references with generic arguments.
 *
 * A concrete type has:
 * - `child`: The base type being referenced (always a `reference` type)
 * - `typeArgs`: The type arguments being passed to the template
 *
 * Example: `SomeTemplate<int, string>` would have child=reference to SomeTemplate,
 * typeArgs=[int, string]
 */
function mcdoc_concrete(type: mcdoc.McdocType) {
    Assert.ConcreteType(type)

    const child = type.child
    Assert.ReferenceType(child)

    const type_args = type.typeArgs

    return (args: Record<string, unknown>) => {
        // Resolve each type argument
        const resolved_args = [] as unknown as NonEmptyList<ts.TypeNode>
        const imports = {
            ordered: [child.path] as NonEmptyList<string>,
            check: new Map<string, number>([[child.path, 0]]),
        } as const

        let child_dispatcher: NonEmptyList<[number, string]> | undefined

        // Process each type argument
        for (const type_arg of type_args) {
            const arg_result = TypeHandlers[type_arg.kind](type_arg)(args)

            if ('imports' in arg_result) {
                merge_imports(imports, arg_result.imports)
            }
            if ('child_dispatcher' in arg_result) {
                if (child_dispatcher === undefined) {
                    child_dispatcher = [] as unknown as typeof child_dispatcher
                }
                child_dispatcher!.push(...(arg_result.child_dispatcher as NonEmptyList<[number, string]>))
            }
            resolved_args.push(arg_result.type)
        }

        const type_name = child.path.slice(child.path.lastIndexOf(':') + 1)

        return {
            type: factory.createTypeReferenceNode(
                type_name,
                resolved_args
            ),
            imports,
            ...(child_dispatcher !== undefined ? { child_dispatcher } : {}),
        } as const
    }
}

export const McdocConcrete = mcdoc_concrete satisfies TypeHandler
