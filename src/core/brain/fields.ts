/** The front matter of a page (§3.3). There is no state, no approval and no confidence: a page is in the brain or it is not. */

export interface FieldSpec {
  name: string;
  required: boolean;
  /** Only decisions carry it. */
  decisionsOnly?: true;
}

/** Every field a page may hold, in the order the tool writes them. */
export const FIELDS: readonly FieldSpec[] = [
  { name: "kind", required: true },
  { name: "id", required: true },
  { name: "namespace", required: true },
  { name: "title", required: true },
  { name: "summary", required: false },
  { name: "aliases", required: false },
  { name: "created", required: true },
  { name: "source", required: true },
  { name: "source_version", required: false },
  { name: "evidence", required: false },
  { name: "stale_after", required: false },
  { name: "applies_to", required: false },
  { name: "status", required: false },
  { name: "verified", required: false },
  { name: "supersedes", required: false, decisionsOnly: true },
  { name: "superseded_by", required: false, decisionsOnly: true },
];

export const FIELD_NAMES: readonly string[] = FIELDS.map((f) => f.name);
export const REQUIRED_FIELDS: readonly string[] = FIELDS.filter((f) => f.required).map((f) => f.name);
