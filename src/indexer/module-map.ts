type SymbolEntry = { id: string; name: string };

export class ModuleMap {
  /** filePath → Map<symbolName, symbolId> */
  private fileSymbols = new Map<string, Map<string, string>>();
  /** symbolName → first symbolId registered */
  private nameIndex = new Map<string, string>();

  register(filePath: string, symbols: SymbolEntry[]): void {
    const byName = new Map<string, string>();
    for (const s of symbols) {
      byName.set(s.name, s.id);
      if (!this.nameIndex.has(s.name)) {
        this.nameIndex.set(s.name, s.id);
      }
    }
    this.fileSymbols.set(filePath, byName);
  }

  /** Returns first registered symbol ID for this name, or null */
  findSymbol(name: string): string | null {
    return this.nameIndex.get(name) ?? null;
  }

  /** Returns symbol ID in a specific file, or null */
  getSymbolId(filePath: string, name: string): string | null {
    return this.fileSymbols.get(filePath)?.get(name) ?? null;
  }
}
