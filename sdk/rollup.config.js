import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import replace from '@rollup/plugin-replace';
import dts from 'rollup-plugin-dts';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read version from api/src/version.ts (single source of truth)
const versionContent = fs.readFileSync(path.join(__dirname, '../api/src/version.ts'), 'utf-8');
const versionMatch = versionContent.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
const SDK_VERSION = versionMatch ? versionMatch[1] : '0.0.0';

const production = !process.env.ROLLUP_WATCH;

export default [
  // UMD bundle (browser script tag)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/staminads.min.js',
      format: 'umd',
      name: 'Staminads',
      exports: 'default',
      sourcemap: true,
    },
    plugins: [
      replace({
        preventAssignment: true,
        values: {
          __SDK_VERSION__: JSON.stringify(SDK_VERSION),
        },
      }),
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json' }),
      production && terser({
        compress: {
          drop_console: production,
          drop_debugger: production,
        },
      }),
    ],
  },
  // ESM bundle (modern bundlers)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/staminads.esm.js',
      format: 'es',
      sourcemap: true,
    },
    plugins: [
      replace({
        preventAssignment: true,
        values: {
          __SDK_VERSION__: JSON.stringify(SDK_VERSION),
        },
      }),
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json' }),
    ],
    external: ['ua-parser-js'],
  },
  // CJS bundle (Node.js/SSR)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/staminads.cjs.js',
      format: 'cjs',
      sourcemap: true,
    },
    plugins: [
      replace({
        preventAssignment: true,
        values: {
          __SDK_VERSION__: JSON.stringify(SDK_VERSION),
        },
      }),
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json' }),
    ],
    external: ['ua-parser-js'],
  },
  // TypeScript declarations
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/staminads.d.ts',
      format: 'es',
    },
    plugins: [dts()],
  },
];
