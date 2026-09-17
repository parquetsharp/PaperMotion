import type { EvidenceSource } from "./evidence";

const STOP_WORDS = new Set("a an and are as at be by for from in is it of on or paper source study that the this to was we with work".split(" "));

export function sourceWords(text: string): string[] {
  return [...new Set(text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").match(/[a-z0-9]{3,}/g) ?? [])].filter(word => !STOP_WORDS.has(word));
}

export function isBibliographyPage(text: string): boolean {
  const references = text.match(/(?:^|\n)\s*(?:references|bibliography)\s*(?:\n|$)/i);
  if (references && (references.index ?? 0) < text.length / 3) return true;
  const years = text.match(/\b(?:19|20)\d{2}[a-z]?\b/g) ?? [];
  const entries = text.match(/(?:^|\n)\s*\[\d+\]/g) ?? [];
  return years.length >= 8 && (entries.length >= 4 || years.length * 180 > text.length);
}

export function selectSourcePages(source: EvidenceSource, query: string, preferredPage?: number): EvidenceSource {
  const words = sourceWords(query).slice(0, 40);
  const ranked = source.pages.filter(page => !isBibliographyPage(page.text)).map(page => {
    const present = new Set(sourceWords(page.text));
    const matches = words.filter(word => present.has(word)).length;
    return { page, score: matches + (matches && page.pageIndex === preferredPage ? 0.5 : 0) };
  }).filter(item => item.score > 0).sort((left, right) => right.score - left.score || left.page.pageIndex - right.page.pageIndex);
  let characters = 0;
  const pages: EvidenceSource["pages"] = [];
  for (const { page } of ranked) {
    if (pages.length === 4 || characters + page.text.length > 40000) continue;
    pages.push(page);
    characters += page.text.length;
  }
  return { ...source, pages: pages.sort((left, right) => left.pageIndex - right.pageIndex) };
}