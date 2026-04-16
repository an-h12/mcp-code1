export class IdMapper {
  private uuidToInt = new Map<string, number>();
  private intToUuid: string[] = [];

  intern(uuid: string): number {
    const existing = this.uuidToInt.get(uuid);
    if (existing !== undefined) return existing;
    const id = this.intToUuid.length;
    this.intToUuid.push(uuid);
    this.uuidToInt.set(uuid, id);
    return id;
  }

  resolve(id: number): string {
    const uuid = this.intToUuid[id];
    if (uuid === undefined) {
      throw new Error(`IdMapper: unknown IntId ${id} — possible orphaned edge`);
    }
    return uuid;
  }

  get size(): number {
    return this.intToUuid.length;
  }
}
