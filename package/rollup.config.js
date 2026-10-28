import peerDepsExternal from 'rollup-plugin-peer-deps-external';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';
import babel from '@rollup/plugin-babel';

const packageJson = require('./package.json');

const config = [
    {
        input: 'src/index.js',
        output: [
            {
                file: packageJson.main,
                format: 'cjs',
                sourcemap: true,
            },
            {
                file: packageJson.module,
                format: 'esm',
                sourcemap: true,
            },
        ],
        plugins: [
            peerDepsExternal(),
            resolve(),
            commonjs(),
            terser(),
            babel({
                exclude: 'node_modules/**',
                babelHelpers: 'bundled',
                presets: ['@babel/preset-react'],
            }),
        ],
        external: ['react', 'react-dom'],
    }
];

export default config;