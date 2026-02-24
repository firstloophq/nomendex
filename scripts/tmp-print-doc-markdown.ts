import { loadCanonicalSnapshot } from "../team-backend/src/collab/persistence";
import { decodeRecordSnapshot, crdtToProseMirror } from "@crdt/lib";
import { tableSchema, tableMarkdownSerializer } from "../bun-sidecar/src/components/prosemirror/tables";

const docId = process.argv[2] ?? "ws:cmlsgel0l001nlorinakst5rx:note:2-18-2026.md";
const orgWorkspaceId = process.argv[3] ?? "cmlsgel0l001nlorinakst5rx";

const snapshot = await loadCanonicalSnapshot({ docId, orgWorkspaceId });
if (!snapshot) {
  console.error("NO_SNAPSHOT");
  process.exit(2);
}

const record = decodeRecordSnapshot({ data: snapshot.bytes });
const pmDoc = crdtToProseMirror({ doc: record.body, schema: tableSchema });
const markdown = tableMarkdownSerializer.serialize(pmDoc);

console.log(markdown);
