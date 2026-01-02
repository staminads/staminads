import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';

const production = !process.env.ROLLUP_WATCH;

export default [
  // UMD bundle (browser script tag)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/staminads.min.js',
      format: 'umd',
      name: 'Staminads',
      sourcemap: true,
    },
    plugins: [
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
