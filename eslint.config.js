import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '**/next-env.d.ts', 'db/migrations/**'] },
  ...tseslint.configs.recommended,
  // One-off scripts read raw, untyped PayPal JSON.
  { files: ['scripts/**'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
);
