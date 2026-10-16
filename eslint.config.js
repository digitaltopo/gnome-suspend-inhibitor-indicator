import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import {defineConfig, globalIgnores} from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
    globalIgnores(['dist/', 'build/']),
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: {allowDefaultProject: ['eslint.config.js']},
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_', varsIgnorePattern: '^_'}],
            '@typescript-eslint/prefer-promise-reject-errors': ['error', {allowThrowingUnknown: true}],
        },
    },
    {
        files: ['src/**/*.ts', 'tests/e2e/**/*.ts'],
        languageOptions: {globals: {global: 'readonly', print: 'readonly', printerr: 'readonly'}},
        rules: {
            'no-restricted-globals': [
                'error',
                {name: 'log', message: 'Use console.log()'},
                {name: 'logError', message: 'Use console.warn() or console.error()'},
            ],
        },
    },
    {
        files: ['tests/unit/**/*.ts', 'scripts/**/*.ts', 'eslint.config.js'],
        languageOptions: {globals: globals.node},
    },
    {
        files: ['tests/unit/**/*.ts'],
        rules: {'@typescript-eslint/no-floating-promises': 'off'},
    },
    prettier,
]);
