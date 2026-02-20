type RecordOp = any;
type CRDTRecord = any;
type LamportClock = any;
type FieldOp = any;
type SetOp = any;

interface CRDTModule {
  applyRecordOps: (params: { record: CRDTRecord; ops: ReadonlyArray<RecordOp> }) => CRDTRecord;
  createClock: (params: { clientId: string }) => LamportClock;
  createOperationId: (params: { clientId: string; clock: number }) => { clientId: string; clock: number };
  createRecord: () => CRDTRecord;
  decodeRecordSnapshot: (params: { data: Uint8Array }) => CRDTRecord;
  suggestEdit: (params: {
    doc: unknown;
    clock: LamportClock;
    oldString: string;
    newString: string;
  }) => { success: boolean; error?: string; doc?: unknown; clock?: LamportClock; ops?: ReadonlyArray<RecordOp>; suggestionId?: string };
  generateKeyBetween: (params: { a: string | null; b: string | null }) => string;
  getCardsInColumn: (params: { record: CRDTRecord; column: string }) => ReadonlyArray<{ cardId: string; order: string }>;
  getBodyText: (params: { record: CRDTRecord }) => string;
  increment: (params: { clock: LamportClock }) => {
    clock: LamportClock;
    timestamp: { clientId: string; clock: number };
  };
  suggestInsert: (params: {
    doc: unknown;
    clock: LamportClock;
    content: string;
    anchor?: string;
    position?: "before" | "after";
  }) => { success: boolean; error?: string; doc?: unknown; clock?: LamportClock; ops?: ReadonlyArray<RecordOp>; suggestionId?: string };
  receive: (params: { clock: LamportClock; remoteCounter: number }) => LamportClock;
  recordToMarkdown: (params: { record: CRDTRecord }) => string;
}

async function loadCRDTModule(): Promise<CRDTModule> {
  const candidates = [
    process.env.NOMENDEX_CRDT_MODULE?.trim(),
    "/Users/jacobcolling/crdt/src/crdt/index.ts",
    "/Users/jacobcolling/nomendex/crdt/src/crdt/index.ts",
    "../../../../crdt/src/crdt/index.ts",
    "@crdt/lib",
  ].filter((value): value is string => !!value && value.length > 0);

  for (const candidate of candidates) {
    try {
      return (await import(candidate)) as CRDTModule;
    } catch {
      // Try next candidate path
    }
  }

  throw new Error(
    "Failed to load CRDT module. Set NOMENDEX_CRDT_MODULE to the absolute path of src/crdt/index.ts or install @crdt/lib."
  );
}

const crdt = await loadCRDTModule();
const {
  applyRecordOps,
  createClock,
  createOperationId,
  createRecord,
  decodeRecordSnapshot,
  suggestEdit,
  generateKeyBetween,
  getCardsInColumn,
  getBodyText,
  increment,
  suggestInsert,
  receive,
  recordToMarkdown,
} = crdt;

type Command =
  | "help"
  | "active-scope"
  | "build-doc-id"
  | "read"
  | "replace"
  | "insert"
  | "set-field"
  | "add-set"
  | "remove-set"
  | "move-card";

interface ParsedArgs {
  command: Command;
  flags: Map<string, string>;
  positionals: string[];
}

interface ActiveScopeInfo {
  workspaceId: string;
  orgWorkspaceId: string | null;
  scopeId: string;
}

interface SyncResponseMessage {
  type?: string;
  docId?: string;
  snapshot?: string;
  ops?: ReadonlyArray<RecordOp>;
}

const DEFAULT_SERVER_URL = process.env.NOMENDEX_SERVER_URL ?? "http://localhost:1234";
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_CLIENT_ID = process.env.NOMENDEX_CRDT_CLIENT_ID ?? `agent-${Date.now()}`;

function printUsage(): void {
  console.log(`Usage:
  bun .agents/skills/crdt-agent-edit/scripts/crdt_doc_ws.ts active-scope [--server http://localhost:1234]
  bun .agents/skills/crdt-agent-edit/scripts/crdt_doc_ws.ts build-doc-id --namespace note|card|kanban --resource <value> [--scope <scopeId>] [--server <url>]
  bun .agents/skills/crdt-agent-edit/scripts/crdt_doc_ws.ts read --doc-id <docId> [--format markdown|body|json] [--server <url>] [--token <jwt>] [--client-id <id>]
  bun .agents/skills/crdt-agent-edit/scripts/crdt_doc_ws.ts replace --doc-id <docId> --old <text> --new <text> [--dry-run] [--server <url>] [--token <jwt>] [--client-id <id>]
  bun .agents/skills/crdt-agent-edit/scripts/crdt_doc_ws.ts insert --doc-id <docId> --content <text> [--anchor <text>] [--position before|after] [--dry-run] [--server <url>] [--token <jwt>] [--client-id <id>]
  bun .agents/skills/crdt-agent-edit/scripts/crdt_doc_ws.ts set-field --doc-id <docId> --field <name> --value <text> [--dry-run] [--server <url>] [--token <jwt>] [--client-id <id>]
  bun .agents/skills/crdt-agent-edit/scripts/crdt_doc_ws.ts add-set --doc-id <docId> --field <name> --value <text> [--dry-run] [--server <url>] [--token <jwt>] [--client-id <id>]
  bun .agents/skills/crdt-agent-edit/scripts/crdt_doc_ws.ts remove-set --doc-id <docId> --field <name> --value <text> [--dry-run] [--server <url>] [--token <jwt>] [--client-id <id>]
  bun .agents/skills/crdt-agent-edit/scripts/crdt_doc_ws.ts move-card --doc-id <boardDocId> --card-id <id> --column <name> [--after-card-id <id>] [--before-card-id <id>] [--dry-run] [--server <url>] [--token <jwt>] [--client-id <id>]

Environment:
  NOMENDEX_SERVER_URL      Default server URL (default: http://localhost:1234)
  NOMENDEX_CRDT_TOKEN      Optional ws token (relay/team mode)
  NOMENDEX_CRDT_CLIENT_ID  Optional stable client id for ws session`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const rawCommand = (argv[0] ?? "help") as Command;
  const supportedCommands = new Set<Command>([
    "help",
    "active-scope",
    "build-doc-id",
    "read",
    "replace",
    "insert",
    "set-field",
    "add-set",
    "remove-set",
    "move-card",
  ]);

  const command = supportedCommands.has(rawCommand) ? rawCommand : "help";
  const flags = new Map<string, string>();
  const positionals: string[] = [];

  let i = 1;
  while (i < argv.length) {
    const token = argv[i]!;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const maybeValue = argv[i + 1];
      if (maybeValue !== undefined && !maybeValue.startsWith("--")) {
        flags.set(key, maybeValue);
        i += 2;
      } else {
        flags.set(key, "true");
        i += 1;
      }
    } else {
      positionals.push(token);
      i += 1;
    }
  }

  return { command, flags, positionals };
}

function getFlag(flags: Map<string, string>, key: string): string | undefined {
  return flags.get(key);
}

function requireFlag(flags: Map<string, string>, key: string): string {
  const value = getFlag(flags, key);
  if (!value) {
    throw new Error(`Missing required flag --${key}`);
  }
  return value;
}

function hasFlag(flags: Map<string, string>, key: string): boolean {
  return flags.get(key) === "true";
}

function parseServerUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid --server URL: ${raw}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`--server must be http:// or https://, received: ${url.protocol}`);
  }

  url.search = "";
  url.hash = "";
  return url;
}

function buildHttpUrl(params: { serverUrl: string; path: string }): string {
  const base = parseServerUrl(params.serverUrl);
  const finalUrl = new URL(params.path, base);
  return finalUrl.toString();
}

function buildWsUrl(params: {
  serverUrl: string;
  clientId: string;
  token?: string;
}): string {
  const base = parseServerUrl(params.serverUrl);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/ws/crdt";
  base.search = "";
  base.hash = "";
  base.searchParams.set("clientId", params.clientId);
  if (params.token) {
    base.searchParams.set("token", params.token);
  }
  return base.toString();
}

async function fetchActiveScope(params: { serverUrl: string }): Promise<ActiveScopeInfo> {
  const endpoint = buildHttpUrl({ serverUrl: params.serverUrl, path: "/api/workspaces/active" });
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to fetch active workspace: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as {
    success?: boolean;
    data?: { id?: string; orgWorkspaceId?: string | null };
    message?: string;
  };

  if (!payload.success || !payload.data?.id) {
    const message = payload.message ?? "Active workspace unavailable";
    throw new Error(message);
  }

  const workspaceId = payload.data.id;
  const orgWorkspaceId = payload.data.orgWorkspaceId?.trim() || null;
  const scopeId = orgWorkspaceId ?? workspaceId;
  return { workspaceId, orgWorkspaceId, scopeId };
}

function encodeResource(resource: string): string {
  return encodeURIComponent(resource);
}

function buildWorkspaceDocId(params: {
  scopeId: string;
  namespace: "note" | "card" | "kanban";
  resourceId: string;
}): string {
  return `ws:${params.scopeId}:${params.namespace}:${encodeResource(params.resourceId)}`;
}

function mapKanbanProjectKey(raw: string): string {
  if (raw === "null") return "__all__";
  if (raw === "empty") return "__none__";
  return raw;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function messageDataToString(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return null;
}

function stateVectorToObject(stateVector: ReadonlyMap<string, number>): Record<string, number> {
  const output: Record<string, number> = {};
  for (const [clientId, clock] of stateVector) {
    output[clientId] = clock;
  }
  return output;
}

function extractFields(record: CRDTRecord): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [fieldName, reg] of record.fields) {
    output[fieldName] = reg.value;
  }
  return output;
}

function extractSets(record: CRDTRecord): Record<string, string[]> {
  const output: Record<string, string[]> = {};
  for (const [fieldName, orSet] of record.sets) {
    const values = new Set<string>();
    for (const entries of orSet.entries.values()) {
      const active = entries.some((entry) => !entry.removed);
      if (active && entries[0]) {
        values.add(String(entries[0].value));
      }
    }
    output[fieldName] = Array.from(values.values()).sort();
  }
  return output;
}

async function waitForSocketOpen(params: { ws: WebSocket; timeoutMs: number }): Promise<void> {
  const { ws, timeoutMs } = params;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for WebSocket connection"));
    }, timeoutMs);

    const onOpen = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("WebSocket error before open"));
    };

    const onClose = () => {
      cleanup();
      reject(new Error("WebSocket closed before open"));
    };

    function cleanup() {
      clearTimeout(timer);
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
    }

    ws.addEventListener("open", onOpen);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  });
}

async function waitForSyncRecord(params: {
  ws: WebSocket;
  docId: string;
  timeoutMs: number;
}): Promise<CRDTRecord> {
  const { ws, docId, timeoutMs } = params;

  return new Promise<CRDTRecord>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for sync-response for docId "${docId}"`));
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      const payload = messageDataToString(event.data);
      if (!payload) return;

      let message: SyncResponseMessage;
      try {
        message = JSON.parse(payload) as SyncResponseMessage;
      } catch {
        return;
      }

      if (message.type !== "sync-response" || message.docId !== docId) {
        return;
      }

      try {
        let record = createRecord();
        if (typeof message.snapshot === "string" && message.snapshot.length > 0) {
          const bytes = decodeBase64ToBytes(message.snapshot);
          record = decodeRecordSnapshot({ data: bytes });
        }

        const ops = Array.isArray(message.ops) ? message.ops : [];
        if (ops.length > 0) {
          record = applyRecordOps({ record, ops });
        }

        cleanup();
        resolve(record);
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    const onError = () => {
      cleanup();
      reject(new Error("WebSocket error while waiting for sync-response"));
    };

    const onClose = () => {
      cleanup();
      reject(new Error("WebSocket closed while waiting for sync-response"));
    };

    function cleanup() {
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
    }

    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
    ws.send(JSON.stringify({ type: "subscribe", docId }));
  });
}

async function syncDocument(params: {
  serverUrl: string;
  token?: string;
  clientId: string;
  docId: string;
  timeoutMs: number;
}): Promise<{ ws: WebSocket; record: CRDTRecord }> {
  const wsUrl = buildWsUrl({
    serverUrl: params.serverUrl,
    clientId: params.clientId,
    token: params.token,
  });

  const ws = new WebSocket(wsUrl);
  await waitForSocketOpen({ ws, timeoutMs: params.timeoutMs });
  const record = await waitForSyncRecord({
    ws,
    docId: params.docId,
    timeoutMs: params.timeoutMs,
  });

  return { ws, record };
}

function deriveClockFromRecord(params: {
  clientId: string;
  record: CRDTRecord;
}): LamportClock {
  let clock = createClock({ clientId: params.clientId });

  let maxRemoteClock = 0;
  for (const remoteClock of params.record.stateVector.values()) {
    if (remoteClock > maxRemoteClock) {
      maxRemoteClock = remoteClock;
    }
  }

  if (maxRemoteClock > 0) {
    clock = receive({ clock, remoteCounter: maxRemoteClock });
  }
  return clock;
}

function nextOpIdentity(clock: LamportClock): {
  clock: LamportClock;
  id: { clientId: string; clock: number };
  timestamp: { clientId: string; clock: number };
} {
  const { clock: nextClock, timestamp } = increment({ clock });
  const id = createOperationId({
    clientId: timestamp.clientId,
    clock: timestamp.clock,
  });
  return { clock: nextClock, id, timestamp };
}

async function sendOpsAndClose(params: {
  ws: WebSocket;
  docId: string;
  ops: ReadonlyArray<RecordOp>;
}): Promise<void> {
  if (params.ops.length > 0) {
    params.ws.send(JSON.stringify({ type: "ops", docId: params.docId, ops: params.ops }));
    await sleep(100);
  }
  params.ws.close();
}

function resolveCommonOptions(flags: Map<string, string>): {
  serverUrl: string;
  token: string | undefined;
  clientId: string;
  timeoutMs: number;
} {
  const serverUrl = getFlag(flags, "server") ?? DEFAULT_SERVER_URL;
  const token = getFlag(flags, "token") ?? process.env.NOMENDEX_CRDT_TOKEN;
  const clientId = getFlag(flags, "client-id") ?? DEFAULT_CLIENT_ID;
  const timeoutRaw = getFlag(flags, "timeout-ms");
  const timeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid --timeout-ms value: ${timeoutRaw}`);
  }
  return { serverUrl, token, clientId, timeoutMs };
}

async function runActiveScope(flags: Map<string, string>): Promise<void> {
  const serverUrl = getFlag(flags, "server") ?? DEFAULT_SERVER_URL;
  const scope = await fetchActiveScope({ serverUrl });
  console.log(JSON.stringify(scope, null, 2));
}

async function runBuildDocId(flags: Map<string, string>, positionals: string[]): Promise<void> {
  const namespaceRaw = requireFlag(flags, "namespace");
  if (namespaceRaw !== "note" && namespaceRaw !== "card" && namespaceRaw !== "kanban") {
    throw new Error(`--namespace must be one of: note, card, kanban. Received: ${namespaceRaw}`);
  }

  let resource = getFlag(flags, "resource") ?? positionals[0];
  if (namespaceRaw === "kanban") {
    const projectRaw = getFlag(flags, "project");
    if (projectRaw !== undefined) {
      resource = mapKanbanProjectKey(projectRaw);
    }
  }

  if (!resource) {
    throw new Error("Missing resource id. Provide --resource <value>.");
  }

  let scopeId = getFlag(flags, "scope");
  if (!scopeId) {
    const serverUrl = getFlag(flags, "server") ?? DEFAULT_SERVER_URL;
    scopeId = (await fetchActiveScope({ serverUrl })).scopeId;
  }

  const docId = buildWorkspaceDocId({
    scopeId,
    namespace: namespaceRaw,
    resourceId: resource,
  });

  console.log(docId);
}

async function runRead(flags: Map<string, string>, positionals: string[]): Promise<void> {
  const { serverUrl, token, clientId, timeoutMs } = resolveCommonOptions(flags);
  const docId = getFlag(flags, "doc-id") ?? positionals[0];
  if (!docId) {
    throw new Error("Missing doc id. Provide --doc-id <docId>.");
  }

  const format = getFlag(flags, "format") ?? "markdown";
  if (!["markdown", "body", "json"].includes(format)) {
    throw new Error(`Invalid --format value: ${format}`);
  }

  const { ws, record } = await syncDocument({
    serverUrl,
    token,
    clientId,
    docId,
    timeoutMs,
  });
  ws.close();

  const body = getBodyText({ record });
  const markdown = recordToMarkdown({ record });

  if (format === "body") {
    console.log(body);
    return;
  }

  if (format === "json") {
    console.log(JSON.stringify({
      docId,
      body,
      markdown,
      fields: extractFields(record),
      sets: extractSets(record),
      stateVector: stateVectorToObject(record.stateVector),
    }, null, 2));
    return;
  }

  console.log(markdown);
}

async function runReplace(flags: Map<string, string>, positionals: string[]): Promise<void> {
  const { serverUrl, token, clientId, timeoutMs } = resolveCommonOptions(flags);
  const docId = getFlag(flags, "doc-id") ?? positionals[0];
  if (!docId) {
    throw new Error("Missing doc id. Provide --doc-id <docId>.");
  }

  const oldString = requireFlag(flags, "old");
  const newString = requireFlag(flags, "new");
  const dryRun = hasFlag(flags, "dry-run");

  const { ws, record } = await syncDocument({
    serverUrl,
    token,
    clientId,
    docId,
    timeoutMs,
  });

  const clock = deriveClockFromRecord({ clientId, record });
  const result = suggestEdit({
    doc: record.body,
    clock,
    oldString,
    newString,
  });

  if (!result.success) {
    ws.close();
    throw new Error(`replace failed: ${result.error}`);
  }

  const previewRecord = applyRecordOps({
    record,
    ops: result.ops as ReadonlyArray<RecordOp>,
  });

  if (!dryRun) {
    await sendOpsAndClose({
      ws,
      docId,
      ops: result.ops as ReadonlyArray<RecordOp>,
    });
  } else {
    ws.close();
  }

  console.log(JSON.stringify({
    command: "replace",
    dryRun,
    docId,
    opCount: result.ops.length,
    suggestionId: "suggestionId" in result ? result.suggestionId ?? null : null,
    body: getBodyText({ record: previewRecord }),
  }, null, 2));
}

async function runInsert(flags: Map<string, string>, positionals: string[]): Promise<void> {
  const { serverUrl, token, clientId, timeoutMs } = resolveCommonOptions(flags);
  const docId = getFlag(flags, "doc-id") ?? positionals[0];
  if (!docId) {
    throw new Error("Missing doc id. Provide --doc-id <docId>.");
  }

  const content = getFlag(flags, "content") ?? positionals[1];
  if (!content) {
    throw new Error("Missing insert content. Provide --content <text>.");
  }

  const anchor = getFlag(flags, "anchor");
  const positionRaw = getFlag(flags, "position");
  const position = positionRaw ?? "after";
  if (position !== "before" && position !== "after") {
    throw new Error(`--position must be "before" or "after". Received: ${position}`);
  }
  const dryRun = hasFlag(flags, "dry-run");

  const { ws, record } = await syncDocument({
    serverUrl,
    token,
    clientId,
    docId,
    timeoutMs,
  });

  const clock = deriveClockFromRecord({ clientId, record });
  const result = suggestInsert({
    doc: record.body,
    clock,
    content,
    anchor,
    position,
  });

  if (!result.success) {
    ws.close();
    throw new Error(`insert failed: ${result.error}`);
  }

  const previewRecord = applyRecordOps({
    record,
    ops: result.ops as ReadonlyArray<RecordOp>,
  });

  if (!dryRun) {
    await sendOpsAndClose({
      ws,
      docId,
      ops: result.ops as ReadonlyArray<RecordOp>,
    });
  } else {
    ws.close();
  }

  console.log(JSON.stringify({
    command: "insert",
    dryRun,
    docId,
    opCount: result.ops.length,
    suggestionId: "suggestionId" in result ? result.suggestionId ?? null : null,
    body: getBodyText({ record: previewRecord }),
  }, null, 2));
}

async function runSetField(flags: Map<string, string>, positionals: string[]): Promise<void> {
  const { serverUrl, token, clientId, timeoutMs } = resolveCommonOptions(flags);
  const docId = getFlag(flags, "doc-id") ?? positionals[0];
  if (!docId) {
    throw new Error("Missing doc id. Provide --doc-id <docId>.");
  }

  const fieldName = requireFlag(flags, "field");
  const value = requireFlag(flags, "value");
  const dryRun = hasFlag(flags, "dry-run");

  const { ws, record } = await syncDocument({
    serverUrl,
    token,
    clientId,
    docId,
    timeoutMs,
  });

  let clock = deriveClockFromRecord({ clientId, record });
  const next = nextOpIdentity(clock);
  clock = next.clock;
  const op: FieldOp = {
    type: "field",
    id: next.id,
    fieldName,
    value,
    timestamp: next.timestamp,
  };

  const previewRecord = applyRecordOps({ record, ops: [op] });
  if (!dryRun) {
    await sendOpsAndClose({ ws, docId, ops: [op] });
  } else {
    ws.close();
  }

  console.log(JSON.stringify({
    command: "set-field",
    dryRun,
    docId,
    field: fieldName,
    value,
    stateVector: stateVectorToObject(previewRecord.stateVector),
  }, null, 2));
}

async function runAddSet(flags: Map<string, string>, positionals: string[]): Promise<void> {
  const { serverUrl, token, clientId, timeoutMs } = resolveCommonOptions(flags);
  const docId = getFlag(flags, "doc-id") ?? positionals[0];
  if (!docId) {
    throw new Error("Missing doc id. Provide --doc-id <docId>.");
  }

  const fieldName = requireFlag(flags, "field");
  const value = requireFlag(flags, "value");
  const dryRun = hasFlag(flags, "dry-run");

  const { ws, record } = await syncDocument({
    serverUrl,
    token,
    clientId,
    docId,
    timeoutMs,
  });

  let clock = deriveClockFromRecord({ clientId, record });
  const next = nextOpIdentity(clock);
  clock = next.clock;
  const op: SetOp = {
    type: "set",
    id: next.id,
    fieldName,
    action: "add",
    value,
  };

  const previewRecord = applyRecordOps({ record, ops: [op] });
  if (!dryRun) {
    await sendOpsAndClose({ ws, docId, ops: [op] });
  } else {
    ws.close();
  }

  console.log(JSON.stringify({
    command: "add-set",
    dryRun,
    docId,
    field: fieldName,
    value,
    setValues: extractSets(previewRecord)[fieldName] ?? [],
  }, null, 2));
}

async function runRemoveSet(flags: Map<string, string>, positionals: string[]): Promise<void> {
  const { serverUrl, token, clientId, timeoutMs } = resolveCommonOptions(flags);
  const docId = getFlag(flags, "doc-id") ?? positionals[0];
  if (!docId) {
    throw new Error("Missing doc id. Provide --doc-id <docId>.");
  }

  const fieldName = requireFlag(flags, "field");
  const value = requireFlag(flags, "value");
  const dryRun = hasFlag(flags, "dry-run");

  const { ws, record } = await syncDocument({
    serverUrl,
    token,
    clientId,
    docId,
    timeoutMs,
  });

  const fieldSet = record.sets.get(fieldName);
  const entries = fieldSet?.entries.get(String(value)) ?? [];
  const removeIds = entries.filter((entry) => !entry.removed).map((entry) => entry.id);

  if (removeIds.length === 0) {
    ws.close();
    console.log(JSON.stringify({
      command: "remove-set",
      dryRun,
      docId,
      field: fieldName,
      value,
      opCount: 0,
      note: "No active entries found for value; nothing to remove.",
    }, null, 2));
    return;
  }

  let clock = deriveClockFromRecord({ clientId, record });
  const next = nextOpIdentity(clock);
  clock = next.clock;
  const op: SetOp = {
    type: "set",
    id: next.id,
    fieldName,
    action: "remove",
    value,
    removeIds,
  };

  const previewRecord = applyRecordOps({ record, ops: [op] });
  if (!dryRun) {
    await sendOpsAndClose({ ws, docId, ops: [op] });
  } else {
    ws.close();
  }

  console.log(JSON.stringify({
    command: "remove-set",
    dryRun,
    docId,
    field: fieldName,
    value,
    opCount: 1,
    setValues: extractSets(previewRecord)[fieldName] ?? [],
  }, null, 2));
}

async function runMoveCard(flags: Map<string, string>, positionals: string[]): Promise<void> {
  const { serverUrl, token, clientId, timeoutMs } = resolveCommonOptions(flags);
  const boardDocId = getFlag(flags, "doc-id") ?? positionals[0];
  if (!boardDocId) {
    throw new Error("Missing board doc id. Provide --doc-id <boardDocId>.");
  }

  const cardId = requireFlag(flags, "card-id");
  const column = requireFlag(flags, "column");
  const afterCardId = getFlag(flags, "after-card-id");
  const beforeCardId = getFlag(flags, "before-card-id");
  const dryRun = hasFlag(flags, "dry-run");

  const { ws, record } = await syncDocument({
    serverUrl,
    token,
    clientId,
    docId: boardDocId,
    timeoutMs,
  });

  const cardsInColumn = getCardsInColumn({ record, column });
  let afterOrder: string | null = null;
  let beforeOrder: string | null = null;

  if (afterCardId) {
    const after = cardsInColumn.find((card) => card.cardId === afterCardId);
    if (after) {
      afterOrder = after.order;
    }
  }

  if (beforeCardId) {
    const before = cardsInColumn.find((card) => card.cardId === beforeCardId);
    if (before) {
      beforeOrder = before.order;
    }
  }

  if (!afterCardId && !beforeCardId) {
    afterOrder = cardsInColumn.length > 0
      ? cardsInColumn[cardsInColumn.length - 1]!.order
      : null;
  }

  const order = generateKeyBetween({ a: afterOrder, b: beforeOrder });
  const positionValue = JSON.stringify({ column, order });

  let clock = deriveClockFromRecord({ clientId, record });
  const next = nextOpIdentity(clock);
  clock = next.clock;
  const op: FieldOp = {
    type: "field",
    id: next.id,
    fieldName: `card:${cardId}`,
    value: positionValue,
    timestamp: next.timestamp,
  };

  const previewRecord = applyRecordOps({ record, ops: [op] });
  if (!dryRun) {
    await sendOpsAndClose({ ws, docId: boardDocId, ops: [op] });
  } else {
    ws.close();
  }

  console.log(JSON.stringify({
    command: "move-card",
    dryRun,
    boardDocId,
    cardId,
    column,
    order,
    cardsInColumn: getCardsInColumn({ record: previewRecord, column }),
  }, null, 2));
}

async function main(): Promise<void> {
  const { command, flags, positionals } = parseArgs(process.argv.slice(2));

  if (command === "help") {
    printUsage();
    return;
  }

  if (command === "active-scope") {
    await runActiveScope(flags);
    return;
  }

  if (command === "build-doc-id") {
    await runBuildDocId(flags, positionals);
    return;
  }

  if (command === "read") {
    await runRead(flags, positionals);
    return;
  }

  if (command === "replace") {
    await runReplace(flags, positionals);
    return;
  }

  if (command === "insert") {
    await runInsert(flags, positionals);
    return;
  }

  if (command === "set-field") {
    await runSetField(flags, positionals);
    return;
  }

  if (command === "add-set") {
    await runAddSet(flags, positionals);
    return;
  }

  if (command === "remove-set") {
    await runRemoveSet(flags, positionals);
    return;
  }

  if (command === "move-card") {
    await runMoveCard(flags, positionals);
    return;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  printUsage();
  process.exit(1);
});
