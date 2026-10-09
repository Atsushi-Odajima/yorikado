import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: ['.next/**', 'node_modules/**', 'design-kit/**', 'public/sw.js', 'next-env.d.ts', 'tmp/**', 'playwright-report/**', 'test-results/**'],
  },
  {
    files: ['scripts/**', 'tests/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "MemberExpression[object.name='localStorage']", message: 'localStorage is not allowed for business data or tokens.' },
      ],
    },
  },
];

export default config;
