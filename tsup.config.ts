import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: {
      resolve: true,
    },
    sourcemap: true,
    clean: true,
    treeshake: true,
    outDir: 'dist/esm',
  },
  {
    entry: ['src/index.ts'],
    format: ['cjs'],
    sourcemap: true,
    treeshake: true,
    outDir: 'dist/cjs',
    outExtension: () => ({ js: '.cjs' }),
  },
]);
