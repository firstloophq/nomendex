import { serve, type ServerWebSocket } from "bun";
import { appendFileSync, writeFileSync } from "node:fs";
import index from "./index.html";
import { getDocumentText, createEmptyDocument } from "@/crdt/core/apply-operations";
import type { Operation } from "@/crdt/core/operations";
import { receive } from "@/crdt/core/lamport-clock";
import {
  editDocument,
  insertAtAnchor,
  suggestEdit,
  suggestInsert,
  acceptSuggestion,
  rejectSuggestion,
  listSuggestions,
} from "@/crdt/server/document-api";
import { BOARD_DOC_ID, getDoc, applyDocOperation } from "@/crdt/document/doc-manager";
import { deleteDoc } from "@/crdt/document/doc-manager";
import {
  createCard,
  updateCardFields,
  addCardTags,
  removeCardTags,
  moveCard,
  addColumn,
  removeColumn,
  getCardDetail,
  listCards,
  getBoardState,
} from "@/crdt/server/card-api";
import { createCRDTWebSocketHandler } from "@/crdt/server/websocket-handler";
import type { RecordOp } from "@/crdt/document/record";
import {
  loadDocOpsFixtureFromFile,
  saveDocOpsFixtureToFile,
} from "@/crdt/server/doc-ops-fixture";

interface WSData {
  clientId: string;
  connectionId: string;
}

const COLLAB_DOC_ID = "__collab__";
const TLDRAW_DOC_ID = "__tldraw__";
const TLDRAW_FIXTURE_PATH = process.env.TLDRAW_FIXTURE_PATH ?? "fixtures/tldraw.fixture.json";
const TLDRAW_FIXTURE_FLUSH_MS = 150;

let tldrawFixtureTimer: ReturnType<typeof setTimeout> | null = null;

const handler = createCRDTWebSocketHandler({
  serverClientId: "server",
  onDocChanged({ docId }) {
    if (docId === TLDRAW_DOC_ID) {
      scheduleTldrawFixtureWrite();
    }
  },
});

function restoreDocFromOps(params: {
  docId: string;
  ops: ReadonlyArray<RecordOp>;
}) {
  const { docId, ops } = params;
  let { manager, clock } = handler.getDocManagerState();
  for (const op of ops) {
    manager = applyDocOperation({ manager, docId, op });
    if ("id" in op && op.id && typeof op.id.clock === "number") {
      clock = receive({ clock, remoteCounter: op.id.clock });
    }
  }
  handler.setDocManagerState({ state: { manager, clock } });
  if (ops.length > 0) {
    handler.appendDocOps({ docId, ops });
  }
}

function writeTldrawFixtureNow() {
  const ops = handler.getDocOps({ docId: TLDRAW_DOC_ID });
  saveDocOpsFixtureToFile({
    filePath: TLDRAW_FIXTURE_PATH,
    docId: TLDRAW_DOC_ID,
    ops,
  });
}

function scheduleTldrawFixtureWrite() {
  if (tldrawFixtureTimer !== null) {
    clearTimeout(tldrawFixtureTimer);
  }
  tldrawFixtureTimer = setTimeout(() => {
    tldrawFixtureTimer = null;
    writeTldrawFixtureNow();
  }, TLDRAW_FIXTURE_FLUSH_MS);
}

function loadTldrawFixture() {
  const fixture = loadDocOpsFixtureFromFile({
    filePath: TLDRAW_FIXTURE_PATH,
    expectedDocId: TLDRAW_DOC_ID,
  });
  if (!fixture || fixture.ops.length === 0) return;
  restoreDocFromOps({ docId: fixture.docId, ops: fixture.ops });
  console.log(`[tldraw-fixture] restored ${fixture.ops.length} ops from ${TLDRAW_FIXTURE_PATH}`);
}

loadTldrawFixture();

/** Wrap a Bun ServerWebSocket into the runtime-agnostic WSClient interface */
function wrapBunWS(ws: ServerWebSocket<WSData>): { readonly id: string; send(message: string): void } {
  return {
    id: ws.data.connectionId,
    send(message: string) {
      if (ws.readyState === 1) {
        ws.send(message);
      }
    },
  };
}

/** Serialize state vector to plain object */
function stateVectorToObject(sv: ReadonlyMap<string, number>): Record<string, number> {
  const obj: Record<string, number> = {};
  for (const [clientId, clock] of sv) {
    obj[clientId] = clock;
  }
  return obj;
}

/** Get the collab document body, creating it if needed */
function getCollabBody() {
  const record = getDoc({ manager: handler.getDocManagerState().manager, docId: COLLAB_DOC_ID });
  return record?.body ?? createEmptyDocument();
}

/** Apply document-api result ops to the collab doc in DocManager, store, and broadcast */
function applyCollabResult(result: { doc: ReturnType<typeof createEmptyDocument>; clock: ReturnType<typeof import("@/crdt/core/lamport-clock").createClock>; ops: ReadonlyArray<Operation> }) {
  let state = handler.getDocManagerState();
  let manager = state.manager;
  for (const op of result.ops) {
    manager = applyDocOperation({ manager, docId: COLLAB_DOC_ID, op });
  }
  handler.setDocManagerState({ state: { manager, clock: result.clock } });
  handler.appendDocOps({ docId: COLLAB_DOC_ID, ops: result.ops as ReadonlyArray<RecordOp> });
  handler.broadcastDocOps({ docId: COLLAB_DOC_ID, ops: result.ops as ReadonlyArray<RecordOp> });
}


const server = serve<WSData>({
  port: 1212,
  routes: {
    "/api/doc": {
      GET() {
        const doc = getCollabBody();
        const content = getDocumentText({ doc });
        return Response.json({
          content,
          stateVector: stateVectorToObject(doc.stateVector),
        });
      },
    },
    "/api/doc/edit": {
      async POST(req: Request) {
        const body = await req.json() as { oldString: string; newString: string; suggest?: boolean };

        if (typeof body.oldString !== "string" || typeof body.newString !== "string") {
          return Response.json(
            { success: false, error: "oldString and newString are required strings" },
            { status: 400 }
          );
        }

        const serverDoc = getCollabBody();
        const { clock: serverClock } = handler.getDocManagerState();

        if (body.suggest) {
          const result = suggestEdit({
            doc: serverDoc,
            clock: serverClock,
            oldString: body.oldString,
            newString: body.newString,
          });

          if (!result.success) {
            return Response.json({ success: false, error: result.error }, { status: 400 });
          }

          applyCollabResult(result);
          return Response.json({ success: true, suggestionId: result.suggestionId });
        }

        const result = editDocument({
          doc: serverDoc,
          clock: serverClock,
          oldString: body.oldString,
          newString: body.newString,
        });

        if (!result.success) {
          return Response.json({ success: false, error: result.error }, { status: 400 });
        }

        applyCollabResult(result);
        return Response.json({ success: true });
      },
    },
    "/api/doc/insert": {
      async POST(req: Request) {
        const body = await req.json() as {
          content: string;
          anchor?: string;
          position?: "before" | "after";
          suggest?: boolean;
        };

        if (typeof body.content !== "string") {
          return Response.json(
            { success: false, error: "content is a required string" },
            { status: 400 }
          );
        }

        if (body.position !== undefined && body.position !== "before" && body.position !== "after") {
          return Response.json(
            { success: false, error: "position must be 'before' or 'after'" },
            { status: 400 }
          );
        }

        const serverDoc = getCollabBody();
        const { clock: serverClock } = handler.getDocManagerState();

        if (body.suggest) {
          const result = suggestInsert({
            doc: serverDoc,
            clock: serverClock,
            content: body.content,
            anchor: body.anchor,
            position: body.position,
          });

          if (!result.success) {
            return Response.json({ success: false, error: result.error }, { status: 400 });
          }

          applyCollabResult(result);
          return Response.json({ success: true, suggestionId: result.suggestionId });
        }

        const result = insertAtAnchor({
          doc: serverDoc,
          clock: serverClock,
          content: body.content,
          anchor: body.anchor,
          position: body.position,
        });

        if (!result.success) {
          return Response.json({ success: false, error: result.error }, { status: 400 });
        }

        applyCollabResult(result);
        return Response.json({ success: true });
      },
    },
    "/api/doc/ops": {
      GET(req: Request) {
        const url = new URL(req.url);
        const docId = url.searchParams.get("docId") ?? COLLAB_DOC_ID;
        const allOps = handler.getDocOps({ docId });
        return Response.json({
          docId,
          ops: allOps,
          count: allOps.length,
        });
      },
    },
    "/api/doc/suggest/edit": {
      async POST(req: Request) {
        const body = await req.json() as { oldString: string; newString: string };

        if (typeof body.oldString !== "string" || typeof body.newString !== "string") {
          return Response.json(
            { success: false, error: "oldString and newString are required strings" },
            { status: 400 }
          );
        }

        const serverDoc = getCollabBody();
        const { clock: serverClock } = handler.getDocManagerState();

        const result = suggestEdit({
          doc: serverDoc,
          clock: serverClock,
          oldString: body.oldString,
          newString: body.newString,
        });

        if (!result.success) {
          return Response.json({ success: false, error: result.error }, { status: 400 });
        }

        applyCollabResult(result);
        return Response.json({ success: true, suggestionId: result.suggestionId });
      },
    },
    "/api/doc/suggest/insert": {
      async POST(req: Request) {
        const body = await req.json() as {
          content: string;
          anchor?: string;
          position?: "before" | "after";
        };

        if (typeof body.content !== "string") {
          return Response.json(
            { success: false, error: "content is a required string" },
            { status: 400 }
          );
        }

        const serverDoc = getCollabBody();
        const { clock: serverClock } = handler.getDocManagerState();

        const result = suggestInsert({
          doc: serverDoc,
          clock: serverClock,
          content: body.content,
          anchor: body.anchor,
          position: body.position,
        });

        if (!result.success) {
          return Response.json({ success: false, error: result.error }, { status: 400 });
        }

        applyCollabResult(result);
        return Response.json({ success: true, suggestionId: result.suggestionId });
      },
    },
    "/api/doc/suggestions": {
      GET() {
        const doc = getCollabBody();
        return Response.json({
          suggestions: listSuggestions({ doc }),
        });
      },
    },
    // --- Kanban Card API ---
    "/api/cards": {
      GET() {
        return Response.json({ cards: listCards({ manager: handler.getDocManagerState().manager }) });
      },
      async POST(req: Request) {
        const body = await req.json() as {
          id?: string;
          title?: string;
          description?: string;
          tags?: string[];
          column?: string;
          fields?: Record<string, string>;
        };

        const cardId = body.id ?? crypto.randomUUID();
        const fields: Record<string, string> = body.fields ?? {};
        if (body.title) fields.title = body.title;
        if (body.description) fields.description = body.description;

        const kanbanState = handler.getDocManagerState();
        const result = createCard({
          state: kanbanState,
          cardId,
          fields: Object.keys(fields).length > 0 ? fields : undefined,
          tags: body.tags,
          column: body.column,
        });

        handler.setDocManagerState({ state: result.state });

        if (result.ops) {
          for (const { docId, op } of result.ops) {
            handler.appendDocOps({ docId, ops: [op] });
            handler.broadcastDocOps({ docId, ops: [op] });
          }
        }

        return Response.json({ success: true, id: cardId });
      },
    },
    "/api/board": {
      GET() {
        return Response.json(getBoardState({ manager: handler.getDocManagerState().manager }));
      },
    },
    "/api/board/columns": {
      async POST(req: Request) {
        const body = await req.json() as { column: string };
        if (typeof body.column !== "string") {
          return Response.json({ success: false, error: "column is required" }, { status: 400 });
        }
        const kanbanState = handler.getDocManagerState();
        const result = addColumn({ state: kanbanState, column: body.column });
        handler.setDocManagerState({ state: result.state });

        if (result.ops) {
          for (const { docId, op } of result.ops) {
            handler.appendDocOps({ docId, ops: [op] });
          }
          handler.broadcastDocOps({ docId: BOARD_DOC_ID, ops: result.ops.map(o => o.op) });
        }

        return Response.json({ success: true });
      },
    },
    "/api/board/move": {
      async PUT(req: Request) {
        const body = await req.json() as {
          cardId: string;
          column: string;
          afterCardId?: string;
          beforeCardId?: string;
        };
        if (typeof body.cardId !== "string" || typeof body.column !== "string") {
          return Response.json({ success: false, error: "cardId and column are required" }, { status: 400 });
        }
        const kanbanState = handler.getDocManagerState();
        const result = moveCard({
          state: kanbanState,
          cardId: body.cardId,
          column: body.column,
          afterCardId: body.afterCardId,
          beforeCardId: body.beforeCardId,
        });
        handler.setDocManagerState({ state: result.state });

        if (result.ops) {
          for (const { docId, op } of result.ops) {
            handler.appendDocOps({ docId, ops: [op] });
          }
          handler.broadcastDocOps({ docId: BOARD_DOC_ID, ops: result.ops.map(o => o.op) });
        }

        return Response.json({ success: true });
      },
    },
    "/api/log": {
      async POST(req: Request) {
        const body = await req.json() as { timestamp: string; editor: string; event: string; detail: string };
        const line = `[${body.timestamp}] [${body.editor}] ${body.event}: ${body.detail}\n`;
        try {
          appendFileSync("logs.txt", line);
        } catch {
          writeFileSync("logs.txt", line);
        }
        return Response.json({ ok: true });
      },
    },
    "/api/log/clear": {
      POST() {
        writeFileSync("logs.txt", "");
        return Response.json({ ok: true });
      },
    },
    "/api/*": async (req: Request) => {
      const url = new URL(req.url);

      // GET /api/cards/:id
      const cardDetailMatch = url.pathname.match(/^\/api\/cards\/([^/]+)$/);
      if (cardDetailMatch && req.method === "GET") {
        const cardId = cardDetailMatch[1]!;
        const detail = getCardDetail({ manager: handler.getDocManagerState().manager, cardId });
        if (!detail) {
          return Response.json({ success: false, error: "card not found" }, { status: 404 });
        }
        return Response.json(detail);
      }

      // DELETE /api/cards/:id
      if (cardDetailMatch && req.method === "DELETE") {
        const cardId = cardDetailMatch[1]!;
        const kanbanState = handler.getDocManagerState();
        handler.setDocManagerState({
          state: {
            ...kanbanState,
            manager: deleteDoc({ manager: kanbanState.manager, docId: cardId }),
          },
        });
        return Response.json({ success: true });
      }

      // PUT /api/cards/:id/fields
      const cardFieldsMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/fields$/);
      if (cardFieldsMatch && req.method === "PUT") {
        const cardId = cardFieldsMatch[1]!;
        const body = await req.json() as Record<string, string>;
        const kanbanState = handler.getDocManagerState();
        const result = updateCardFields({ state: kanbanState, cardId, fields: body });
        handler.setDocManagerState({ state: result.state });

        if (result.ops) {
          for (const { docId, op } of result.ops) {
            handler.appendDocOps({ docId, ops: [op] });
            handler.broadcastDocOps({ docId, ops: [op] });
          }
        }

        return Response.json({ success: true });
      }

      // PUT /api/cards/:id/tags
      const cardTagsMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/tags$/);
      if (cardTagsMatch && req.method === "PUT") {
        const cardId = cardTagsMatch[1]!;
        const body = await req.json() as { add?: string[]; remove?: string[] };
        let kanbanState = handler.getDocManagerState();

        if (body.add && body.add.length > 0) {
          const result = addCardTags({ state: kanbanState, cardId, tags: body.add });
          kanbanState = result.state;
          handler.setDocManagerState({ state: kanbanState });
          if (result.ops) {
            for (const { docId, op } of result.ops) {
              handler.appendDocOps({ docId, ops: [op] });
              handler.broadcastDocOps({ docId, ops: [op] });
            }
          }
        }
        if (body.remove && body.remove.length > 0) {
          kanbanState = handler.getDocManagerState();
          const result = removeCardTags({ state: kanbanState, cardId, tags: body.remove });
          handler.setDocManagerState({ state: result.state });
          if (result.ops) {
            for (const { docId, op } of result.ops) {
              handler.appendDocOps({ docId, ops: [op] });
              handler.broadcastDocOps({ docId, ops: [op] });
            }
          }
        }

        return Response.json({ success: true });
      }

      // DELETE /api/board/columns/:name
      const boardColMatch = url.pathname.match(/^\/api\/board\/columns\/([^/]+)$/);
      if (boardColMatch && req.method === "DELETE") {
        const column = decodeURIComponent(boardColMatch[1]!);
        const kanbanState = handler.getDocManagerState();
        const result = removeColumn({ state: kanbanState, column });
        handler.setDocManagerState({ state: result.state });

        if (result.ops) {
          for (const { docId, op } of result.ops) {
            handler.appendDocOps({ docId, ops: [op] });
          }
          handler.broadcastDocOps({ docId: BOARD_DOC_ID, ops: result.ops.map(o => o.op) });
        }

        return Response.json({ success: true });
      }

      // /api/doc/suggest/:id/accept or /api/doc/suggest/:id/reject
      const suggestMatch = url.pathname.match(/^\/api\/doc\/suggest\/([^/]+)\/(accept|reject)$/);
      if (suggestMatch && req.method === "POST") {
        const suggestionId = suggestMatch[1]!;
        const action = suggestMatch[2]!;

        const serverDoc = getCollabBody();
        const { clock: serverClock } = handler.getDocManagerState();

        const suggestHandler = action === "accept" ? acceptSuggestion : rejectSuggestion;
        const result = suggestHandler({
          doc: serverDoc,
          clock: serverClock,
          suggestionId,
        });

        if (!result.success) {
          return Response.json({ success: false, error: result.error }, { status: 400 });
        }

        applyCollabResult(result);
        return Response.json({ success: true });
      }

      return Response.json({ error: "not found" }, { status: 404 });
    },
    "/*": index,
  },

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const clientId = url.searchParams.get("clientId") ?? "unknown";
      const connectionId = crypto.randomUUID();
      const upgraded = server.upgrade(req, { data: { clientId, connectionId } });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    return undefined;
  },

  websocket: {
    open(ws) {
      handler.handleOpen({ client: wrapBunWS(ws) });
      console.log(`Client connected: ${ws.data.clientId} (${ws.data.connectionId})`);
    },

    message(ws, message) {
      const msgStr = typeof message === "string" ? message : new TextDecoder().decode(message);
      handler.handleMessage({ client: wrapBunWS(ws), message: msgStr });
    },

    close(ws) {
      handler.handleClose({ client: wrapBunWS(ws) });
      console.log(`Client disconnected: ${ws.data.clientId} (${ws.data.connectionId})`);
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`Server running at ${server.url}`);
