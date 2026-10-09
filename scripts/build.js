import { build } from 'esbuild';
await build({ entryPoints: ['src/auth-client.js'], outfile: 'public/firebase-client.js', bundle: true, format: 'esm', minify: true, sourcemap: false, target: ['es2022'], legalComments: 'eof' });
