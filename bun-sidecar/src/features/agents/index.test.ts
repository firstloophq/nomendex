import { describe, expect, test } from "bun:test";
import { mergeAgentPreferences } from "./index";

describe("mergeAgentPreferences", () => {
    test("preserves default agent allowed tools when updating last used agent", () => {
        const current = {
            lastUsedAgentId: "default",
            defaultAgentAllowedTools: ["Bash"],
        };

        const updated = mergeAgentPreferences(current, {
            lastUsedAgentId: "agent-123",
        });

        expect(updated.lastUsedAgentId).toBe("agent-123");
        expect(updated.defaultAgentAllowedTools).toEqual(["Bash"]);
    });

    test("supports explicitly clearing default agent allowed tools", () => {
        const current = {
            lastUsedAgentId: "default",
            defaultAgentAllowedTools: ["Bash", "Read"],
        };

        const updated = mergeAgentPreferences(current, {
            defaultAgentAllowedTools: [],
        });

        expect(updated.defaultAgentAllowedTools).toEqual([]);
    });
});
