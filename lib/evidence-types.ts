export type EvidenceKind = "stated" | "derived" | "assumption" | "unsupported";
export type EvidenceRect = { x: number; y: number; width: number; height: number };
export type EvidencePassage = {
  page: number;
  quote: string;
  start: number;
  end: number;
  pageHash: string;
  rects: EvidenceRect[];
};
export type EvidenceClaim = {
  id: string;
  target: string;
  text: string;
  kind: EvidenceKind;
  rationale: string;
  dependencies: string[];
  verification: "excerpt_matched" | "not_checked";
  issue?: string;
  passages: EvidencePassage[];
};
export type VisualizationEvidence = {
  version: 1;
  docId: string;
  claims: EvidenceClaim[];
  warnings?: string[];
};
export type EvidenceHighlight = EvidencePassage & { docId: string; claimId: string };

export const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
  stated: "Stated in the paper", derived: "Derived", assumption: "Illustrative assumption", unsupported: "Unsupported / not checked",
};