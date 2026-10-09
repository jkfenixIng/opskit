import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/seed.ts'],
  format: ['esm'],
  target: 'node24',
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript sources, so they are bundled into the output.
  noExternal: [/^@opskit\//],
});
