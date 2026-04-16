/**
 * Grammar map for tree-sitter.
 */
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import Go from 'tree-sitter-go';
import Rust from 'tree-sitter-rust';
import Java from 'tree-sitter-java';
import C from 'tree-sitter-c';
import Cpp from 'tree-sitter-cpp';

export type Grammar = {
  name: string;
  language: unknown;
};

const ts = TypeScript as unknown as { typescript: unknown; tsx: unknown };

const EXT_TO_GRAMMAR: Record<string, Grammar> = {
  '.js': { name: 'javascript', language: JavaScript },
  '.jsx': { name: 'javascript', language: JavaScript },
  '.mjs': { name: 'javascript', language: JavaScript },
  '.cjs': { name: 'javascript', language: JavaScript },
  '.ts': { name: 'typescript', language: ts.typescript },
  '.tsx': { name: 'tsx', language: ts.tsx },
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
