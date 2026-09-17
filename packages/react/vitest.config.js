import { defineConfig } from 'vitest/config';
import { transform } from 'esbuild';

// The source keeps JSX in .js files (the published dist is compiled by build.mjs).
// Vite 8's oxc pipeline decides the language from the extension, so we pre-transform JSX here.
function jsxInJs() {
  return {
    name: 'veneer-jsx-in-js',
    enforce: 'pre',
    async transform(code, id) {
      if (!/\/(src|test|e2e)\/.*\.jsx?$/.test(id) || id.includes('node_modules')) return null;
      if (!/<[A-Za-z>]/.test(code)) return null;
      const out = await transform(code, { loader: 'jsx', jsx: 'transform', sourcefile: id, sourcemap: 'inline' });
      return { code: out.code, map: null };
    },
  };
}

export default defineConfig({
  plugins: [jsxInJs()],
  test: {
    include: ['test/**/*.test.{js,jsx}'],
    environment: 'node',
  },
});
