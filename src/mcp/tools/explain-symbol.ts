import type { Db } from '../../db/index.js';
import type { AiAdapter } from '../ai-adapter.js';
import { getSymbolDetail } from './get-symbol-detail.js';

export async function explainSymbol(
  db: Db,
  symbolId: string,
  ai: AiAdapter | null,
): Promise<string> {
  const detail = getSymbolDetail(db, symbolId);
  if (!detail) return 'Symbol not found.';

  const contextParts = [
    `Name: ${detail.name}`,
    `Kind: ${detail.kind}`,
    `File: ${detail.filePath}`,
    `Lines: ${detail.startLine}-${detail.endLine}`,
    `Signature: ${detail.signature}`,
  ];
  if (detail.docComment) contextParts.push(`Doc: ${detail.docComment}`);
  const context = contextParts.join('\n');

  if (ai) {
    return ai.explain(context, `Explain what ${detail.name} does.`);
  }

  let fallback = `**${detail.name}** (${detail.kind})\n\nFile: \`${detail.filePath}\` lines ${detail.startLine}-${detail.endLine}\n\nSignature: \`${detail.signature}\``;
  if (detail.docComment) fallback += `\n\n${detail.docComment}`;
  return fallback;
}
