import { YServer } from "y-partyserver";
import * as Y from "yjs";

/**
 * VaultServer: One Y.js-synced Durable Object per vault.
 * Extends YServer (from y-partyserver) which handles the Y.js sync protocol,
 * WebSocket upgrades, awareness, and connection management automatically.
 */
export class VaultServer extends YServer {
    /**
     * Called when a client connects and the DO needs to load the Y.Doc state.
     * Reads the persisted Y.js update from Durable Object storage.
     */
    async onLoad(): Promise<void> {
        const stored = await this.ctx.storage.get<ArrayBuffer>("yjs-state");
        if (stored) {
            Y.applyUpdate(this.document, new Uint8Array(stored));
        }
    }

    /**
     * Called after edits (debounced) and when the last client disconnects.
     * Persists the full Y.Doc state to Durable Object storage.
     */
    async onSave(): Promise<void> {
        const state = Y.encodeStateAsUpdate(this.document);
        await this.ctx.storage.put("yjs-state", state.buffer as ArrayBuffer);
    }
}
