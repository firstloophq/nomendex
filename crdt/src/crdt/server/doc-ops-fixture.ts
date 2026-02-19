import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RecordOp } from "../document/record";

export interface DocOpsFixtureV1 {
  readonly version: 1;
  readonly docId: string;
  readonly savedAt: string;
  readonly ops: ReadonlyArray<RecordOp>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a JSON fixture that stores a document's op log.
 * Returns null when invalid or mismatched.
 */
export function parseDocOpsFixture(params: {
  json: string;
  expectedDocId?: string;
}): DocOpsFixtureV1 | null {
  const { json, expectedDocId } = params;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed)) return null;
  if (parsed.version !== 1) return null;
  if (typeof parsed.docId !== "string") return null;
  if (typeof parsed.savedAt !== "string") return null;
  if (!Array.isArray(parsed.ops)) return null;
  if (expectedDocId && parsed.docId !== expectedDocId) return null;

  return {
    version: 1,
    docId: parsed.docId,
    savedAt: parsed.savedAt,
    ops: parsed.ops as ReadonlyArray<RecordOp>,
  };
}

/**
 * Read and parse a doc-op fixture file from disk.
 * Returns null when file is missing or invalid.
 */
export function loadDocOpsFixtureFromFile(params: {
  filePath: string;
  expectedDocId?: string;
}): DocOpsFixtureV1 | null {
  const { filePath, expectedDocId } = params;
  if (!existsSync(filePath)) return null;
  const json = readFileSync(filePath, "utf8");
  return parseDocOpsFixture({ json, expectedDocId });
}

/**
 * Persist a document's op log as a JSON fixture.
 * Creates parent directories if needed.
 */
export function saveDocOpsFixtureToFile(params: {
  filePath: string;
  docId: string;
  ops: ReadonlyArray<RecordOp>;
  now?: Date;
}): DocOpsFixtureV1 {
  const { filePath, docId, ops, now } = params;
  const fixture: DocOpsFixtureV1 = {
    version: 1,
    docId,
    savedAt: (now ?? new Date()).toISOString(),
    ops: [...ops],
  };

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(fixture, null, 2));
  return fixture;
}
