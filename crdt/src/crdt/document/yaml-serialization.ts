import type { CRDTRecord, RecordOp, FieldOp, SetOp } from "./record";
import type { LamportClock } from "../core/lamport-clock";
import type { InsertOp } from "../core/operations";
import { increment } from "../core/lamport-clock";
import { createInsertOp, createOperationId } from "../core/operations";
import { getFields, getSetField, getBodyText } from "./record";
import { getSetValues } from "../core/or-set";

// --- YAML Frontmatter Serialization ---
// Converts between CRDTRecord and markdown+YAML format.

export function recordToMarkdown(params: { record: CRDTRecord }): string {
  const fields = getFields({ record: params.record });
  const parts: string[] = [];

  // Check if we have any frontmatter to write
  const hasFields = fields.size > 0;
  const hasSetFields = Array.from(params.record.sets.keys()).some(
    (name) => getSetField({ record: params.record, fieldName: name }).length > 0
  );

  if (hasFields || hasSetFields) {
    parts.push("---");

    // Write scalar fields
    for (const [name, value] of fields) {
      parts.push(`${name}: ${yamlEscapeValue(value)}`);
    }

    // Write set fields
    for (const [name, set] of params.record.sets) {
      const values = getSetValues({ set });
      if (values.length > 0) {
        parts.push(`${name}: [${values.map(yamlEscapeValue).join(", ")}]`);
      }
    }

    parts.push("---");
  }

  // Write body
  const bodyText = getBodyText({ record: params.record });
  if (bodyText) {
    if (parts.length > 0) {
      parts.push("");
    }
    parts.push(bodyText);
  }

  return parts.join("\n");
}

function yamlEscapeValue(value: string): string {
  // Quote strings that contain special YAML characters
  if (
    value.includes(":") ||
    value.includes("#") ||
    value.includes("[") ||
    value.includes("]") ||
    value.includes(",") ||
    value.includes("'") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.startsWith(" ") ||
    value.endsWith(" ")
  ) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

export function markdownToRecordOps(params: {
  markdown: string;
  clientId: string;
  clock: LamportClock;
}): { ops: ReadonlyArray<RecordOp>; clock: LamportClock } {
  const ops: RecordOp[] = [];
  let clock = params.clock;

  const { frontmatter, body } = parseFrontmatter(params.markdown);

  // Generate field ops
  for (const [name, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      // Set field
      for (const item of value) {
        const { clock: newClock, timestamp } = increment({ clock });
        clock = newClock;
        const op: SetOp = {
          type: "set",
          id: createOperationId({ clientId: params.clientId, clock: timestamp.clock }),
          fieldName: name,
          action: "add",
          value: String(item),
        };
        ops.push(op);
      }
    } else {
      // Scalar field
      const { clock: newClock, timestamp } = increment({ clock });
      clock = newClock;
      const op: FieldOp = {
        type: "field",
        id: createOperationId({ clientId: params.clientId, clock: timestamp.clock }),
        fieldName: name,
        value: String(value),
        timestamp,
      };
      ops.push(op);
    }
  }

  // Generate body insert ops (simple: one insert per character, chained)
  if (body.length > 0) {
    let prevId: { clientId: string; clock: number } | null = null;

    for (const char of body) {
      const { clock: newClock, timestamp } = increment({ clock });
      clock = newClock;
      const id = createOperationId({ clientId: params.clientId, clock: timestamp.clock });

      const insertOp: InsertOp = createInsertOp({
        id,
        parentId: prevId ? createOperationId(prevId) : null,
        side: "right",
        content: { type: "text", value: char },
      });

      ops.push(insertOp);
      prevId = { clientId: params.clientId, clock: timestamp.clock };
    }
  }

  return { ops, clock };
}

// Keep backward-compatible aliases
export const cardDocToMarkdown = recordToMarkdown;
export const markdownToCardOps = markdownToRecordOps;

// --- Frontmatter Parser ---

interface ParsedMarkdown {
  frontmatter: Record<string, string | string[]>;
  body: string;
}

function parseFrontmatter(markdown: string): ParsedMarkdown {
  const lines = markdown.split("\n");

  // Check for frontmatter delimiter
  if (lines.length === 0 || lines[0]!.trim() !== "---") {
    return { frontmatter: {}, body: markdown };
  }

  // Find closing delimiter
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    return { frontmatter: {}, body: markdown };
  }

  const frontmatter: Record<string, string | string[]> = {};
  const fmLines = lines.slice(1, closingIndex);

  for (const line of fmLines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Check if it's an inline array: [a, b, c]
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1);
      const items = inner
        .split(",")
        .map((s) => unquoteYaml(s.trim()))
        .filter((s) => s.length > 0);
      frontmatter[key] = items;
    } else {
      frontmatter[key] = unquoteYaml(value);
    }
  }

  // Body is everything after the closing delimiter (skip optional blank line)
  let bodyStart = closingIndex + 1;
  if (bodyStart < lines.length && lines[bodyStart]!.trim() === "") {
    bodyStart++;
  }
  const body = lines.slice(bodyStart).join("\n");

  return { frontmatter, body };
}

function unquoteYaml(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  return value;
}
