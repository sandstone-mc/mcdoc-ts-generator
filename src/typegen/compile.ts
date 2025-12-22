import ts from 'typescript'
import { ESLint } from 'eslint'
import stylistic from '@stylistic/eslint-plugin'
import wrap from '@seahax/eslint-plugin-wrap'
import tsparser from '@typescript-eslint/parser'

const eslint = new ESLint({
    fix: true,
    overrideConfigFile: true,
    overrideConfig: [
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
            },
            rules: {
                '@stylistic/indent': ['error', 2],
                '@stylistic/quotes': ['error', 'single'],
                '@stylistic/semi': ['error', 'never'],
                '@stylistic/member-delimiter-style': ['error', {
                    multiline: { delimiter: 'none' },
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
                '@stylistic/padding-line-between-statements': ['error',
                    { blankLine: 'always', prev: 'export', next: 'export' },
                    { blankLine: 'always', prev: 'import', next: '*' },
                    { blankLine: 'never', prev: 'import', next: 'import' },
                ],
            },
        },
    ],
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