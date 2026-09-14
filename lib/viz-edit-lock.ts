const activeEdits = new Set<string>();

export function isVizEditing(docId: string, tagId: string): boolean {
  return activeEdits.has(`${docId}:${tagId}`);
}

export function beginVizEdit(docId: string, tagId: string): (() => void) | null {
  const key = `${docId}:${tagId}`;
  if (activeEdits.has(key)) return null;
  activeEdits.add(key);
  return () => { activeEdits.delete(key); };
}