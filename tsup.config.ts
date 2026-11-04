import { defineConfig } from 'tsup';

const entry = {
  index: 'src/index.ts',
  'api-emulator': 'src/emulator/index.ts',
};

export default defineConfig([
  {
    entry,
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
    entry,
    format: ['cjs'],
    sourcemap: true,
    treeshake: true,
    clean: false,
    outDir: 'dist/cjs',
    outExtension: () => ({ js: '.cjs' }),
  },
]);
