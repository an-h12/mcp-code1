/**
 * Grammar map for tree-sitter.
 *
 * Each language grammar package exports a Parser.Language in various shapes
 * depending on version. We wrap each with a stable `{ language, name }` record.
 */
// @ts-expect-error - grammar packages ship no types
import JavaScript from 'tree-sitter-javascript';
// @ts-expect-error - grammar packages ship no types
import TypeScript from 'tree-sitter-typescript';
// @ts-expect-error - grammar packages ship no types
import Python from 'tree-sitter-python';
// @ts-expect-error - grammar packages ship no types
import Go from 'tree-sitter-go';
// @ts-expect-error - grammar packages ship no types
import Rust from 'tree-sitter-rust';
// @ts-expect-error - grammar packages ship no types
import Java from 'tree-sitter-java';
// @ts-expect-error - grammar packages ship no types
import C from 'tree-sitter-c';
// @ts-expect-error - grammar packages ship no types
import Cpp from 'tree-sitter-cpp';

export type Grammar = {
  name: string;
  language: unknown; // tree-sitter Language object
};

const tsLang = (TypeScript as { typescript: unknown; tsx: unknown }).typescript;
const tsxLang = (TypeScript as { typescript: unknown; tsx: unknown }).tsx;

const EXT_TO_GRAMMAR: Record<string, Grammar> = {
  '.js': { name: 'javascript', language: JavaScript },
  '.jsx': { name: 'javascript', language: JavaScript },
  '.mjs': { name: 'javascript', language: JavaScript },
  '.cjs': { name: 'javascript', language: JavaScript },
  '.ts': { name: 'typescript', language: tsLang },
  '.tsx': { name: 'tsx', language: tsxLang },
  '.py': { name: 'python', language: Python },
  '.go': { name: 'go', language: Go },
  '.rs': { name: 'rust', language: Rust },
  '.java': { name: 'java', language: Java },
  '.c': { name: 'c', language: C },
  '.h': { name: 'c', language: C },
  '.cpp': { name: 'cpp', language: Cpp },
  '.cc': { name: 'cpp', language: Cpp },
  '.cxx': { name: 'cpp', language: Cpp },
  '.hpp': { name: 'cpp', language: Cpp },
};

export function grammarForExt(ext: string): Grammar | undefined {
  return EXT_TO_GRAMMAR[ext.toLowerCase()];
}

export function supportedExtensions(): string[] {
  return Object.keys(EXT_TO_GRAMMAR);
}
