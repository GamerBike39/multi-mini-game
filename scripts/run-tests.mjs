import { build } from 'vite';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const result = await build({
    configFile: false,
    root,
    logLevel: 'error',
    build: {
      write: false,
      target: 'es2022',
      rollupOptions: {
        input: path.resolve(root, 'tests/entry.ts'),
        output: { format: 'es' },
      },
    },
  });
  const chunk = result.output?.find((item) => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Bundle de tests introuvable.');
  const encoded = Buffer.from(chunk.code).toString('base64');
  await import(`data:text/javascript;base64,${encoded}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
