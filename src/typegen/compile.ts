import ts from 'typescript'
import { ESLint } from 'eslint'
import { ESLintUtils } from '@typescript-eslint/utils'
import type { FlatConfig } from '@typescript-eslint/utils/ts-eslint'
import stylistic from '@stylistic/eslint-plugin'
import wrap from '@seahax/eslint-plugin-wrap'
import tsparser from '@typescript-eslint/parser'

/**
 * Custom ESLint rule to remove semicolons in mapped type members.
 * The built-in member-delimiter-style rule doesn't handle mapped types.
 */
const mapped_type_delimiter = ESLintUtils.RuleCreator.withoutDocs({
  meta: {
    type: 'layout',
    fixable: 'code',
    schema: [],
    messages: {
      removeSemicolon: 'Remove semicolon in mapped type',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      TSMappedType(node) {
        const source = context.sourceCode
        const text = source.getText(node)

        // The semicolon appears after the type annotation, before the closing }
        // Find the last } which closes the mapped type
        let brace_depth = 0
        let semi_index = -1
        for (let i = text.length - 1; i >= 0; i--) {
          const char = text[i]
          if (char === '}') {
            brace_depth++
          } else if (char === '{') {
            brace_depth--
          } else if (char === ';' && brace_depth === 1) {
            // Found semicolon at mapped type's top level (inside its own braces)
            semi_index = i
            break
          }
        }

        if (semi_index !== -1) {
          const start = node.range[0] + semi_index
          context.report({
            loc: source.getLocFromIndex(start),
            messageId: 'removeSemicolon',
            fix(fixer) {
              return fixer.removeRange([start, start + 1])
            },
          })
        }
      },
    }
  },
})

const eslint_config: FlatConfig.ConfigArray = [
  wrap.config({
    maxLen: 120,
    tabWidth: 2,
    autoFix: true,
    severity: 'warn',
  }),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@stylistic': stylistic,
      '@custom': { rules: { 'mapped-type-delimiter': mapped_type_delimiter } },
    },
    rules: {
      '@stylistic/indent': ['error', 2],
      '@stylistic/quotes': ['error', 'single'],
      '@stylistic/semi': ['error', 'never'],
      '@custom/mapped-type-delimiter': 'error',
      '@stylistic/member-delimiter-style': ['error', {
        multiline: { delimiter: 'comma', requireLast: true },
        singleline: { delimiter: 'comma', requireLast: false },
      }],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/array-bracket-spacing': ['error', 'never'],
      '@stylistic/block-spacing': ['error', 'always'],
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
      '@stylistic/key-spacing': ['error', { beforeColon: false, afterColon: true }],
      '@stylistic/keyword-spacing': ['error', { before: true, after: true }],
      '@stylistic/space-before-blocks': ['error', 'always'],
      '@stylistic/space-infix-ops': 'error',
      '@stylistic/eol-last': ['error', 'always'],
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/no-multiple-empty-lines': ['error', { max: 1 }],
      '@stylistic/multiline-comment-style': ['error', 'starred-block'],
      '@stylistic/padding-line-between-statements': ['error',
        { blankLine: 'always', prev: 'export', next: 'export' },
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'never', prev: 'import', next: 'import' },
      ],
    },
  },
]

const eslint = new ESLint({
  fix: true,
  overrideConfigFile: true,
  // ESLint's types are incompatible with typescript-eslint's FlatConfig types
  overrideConfig: eslint_config as ESLint.Options['overrideConfig'],
})

export async function compile_types(nodes: ts.Node[], file = 'code.ts') {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, omitTrailingSemicolon: true })

  const printed = printer.printList(
    ts.ListFormat.MultiLine,
    ts.factory.createNodeArray(nodes),
    ts.createSourceFile(
      file,
      '',
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TS
    )
  )

  const results = await eslint.lintText(printed, { filePath: file })

  if (results.length > 0) {
    const result = results[0]
    if (result.errorCount > 0 && !result.output) {
      console.log(`[ESLint] ${file}: ${result.errorCount} errors`)
      console.log('[ESLint] Sample messages:', result.messages.slice(0, 3))
    }
    if (result.output) {
      return result.output
    }
  }

  return printed
}