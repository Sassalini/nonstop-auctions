import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Compile server-only modules in memory with explicit provider replacements.
// This never starts Next.js, loads .env files, or makes provider requests.
const require = createRequire(import.meta.url);
export function loadServerModule(file, replacements) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const loaded = { exports: {} };
  const mockedRequire = name => {
    if (name === 'server-only') return {};
    if (Object.hasOwn(replacements, name)) return replacements[name];
    if (name === 'stripe' || name === '@supabase/supabase-js') return require(name);
    throw new Error(`Unmocked server dependency: ${name}`);
  };
  new Function('require', 'module', 'exports', code)(mockedRequire, loaded, loaded.exports);
  return loaded.exports;
}
