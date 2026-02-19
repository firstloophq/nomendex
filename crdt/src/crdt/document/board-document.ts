import type { CRDTRecord } from "./record";
import { getSetField, getField } from "./record";

// --- Board Helpers ---
// A board is a CRDTRecord with conventions:
//   sets["columns"]       → OR-Set of column names
//   fields["card:<cardId>"] → LWW of JSON { column, order }

export interface CardPosition {
  readonly column: string;
  readonly order: string; // fractional index
}

export function getColumns(params: { record: CRDTRecord }): ReadonlyArray<string> {
  return getSetField({ record: params.record, fieldName: "columns" });
}

export function getCardsInColumn(params: {
  record: CRDTRecord;
  column: string;
}): ReadonlyArray<{ cardId: string; order: string }> {
  const result: { cardId: string; order: string }[] = [];

  for (const [fieldName, reg] of params.record.fields) {
    if (!fieldName.startsWith("card:")) continue;
    const pos = parseCardPosition(reg.value);
    if (pos && pos.column === params.column) {
      result.push({ cardId: fieldName.slice(5), order: pos.order });
    }
  }

  return result.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
}

export function getCardPosition(params: {
  record: CRDTRecord;
  cardId: string;
}): CardPosition | undefined {
  const value = getField({ record: params.record, fieldName: `card:${params.cardId}` });
  if (!value) return undefined;
  return parseCardPosition(value);
}

function parseCardPosition(json: string): CardPosition | undefined {
  try {
    const parsed = JSON.parse(json) as { column: string; order: string };
    if (typeof parsed.column === "string" && typeof parsed.order === "string") {
      return { column: parsed.column, order: parsed.order };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
