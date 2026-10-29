import { defineConfig } from 'vitest/config';

export default defineConfig({
  // apps/web's tsconfig keeps jsx: "preserve" for Next.js; tests compile JSX themselves (React automatic runtime).
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**'],
  },
});
