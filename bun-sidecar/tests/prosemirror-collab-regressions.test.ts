import { afterEach, describe, expect, it } from "bun:test";
import { createTwoPeerHarness, type ScenarioStep } from "./harness/pm-collab-harness";

function keys(actor: "A" | "B", text: string): ScenarioStep[] {
    return Array.from(text).map((key) => ({ actor, key }));
}

describe("prosemirror collab regressions", () => {
    let currentHarness: ReturnType<typeof createTwoPeerHarness> | null = null;

    afterEach(() => {
        currentHarness?.destroy();
        currentHarness = null;
    });

    it("heading input rule syncs for ## + Space", async () => {
        currentHarness = createTwoPeerHarness({ schedulerMode: "immediate" });
        await currentHarness.runSteps([
            ...keys("A", "##"),
            { actor: "A", key: "Space" },
            ...keys("A", "Test"),
        ]);
        currentHarness.assertPeersEquivalent("strict");
        const a = currentHarness.getPeerSnapshot("A");
        expect(a.normalizedMarkdown).toContain("## Test");
    });

    it("heading input rule syncs for # + Space", async () => {
        currentHarness = createTwoPeerHarness({ schedulerMode: "immediate" });
        await currentHarness.runSteps([
            ...keys("A", "#"),
            { actor: "A", key: "Space" },
            ...keys("A", "Test"),
        ]);
        currentHarness.assertPeersEquivalent("strict");
        const a = currentHarness.getPeerSnapshot("A");
        expect(a.normalizedMarkdown).toContain("# Test");
    });

    it("does not promote # to heading inside ordered list items", async () => {
        currentHarness = createTwoPeerHarness({ schedulerMode: "immediate" });
        await currentHarness.runSteps([
            ...keys("A", "1. item"),
            { actor: "A", key: "Enter" },
            ...keys("A", "#"),
            { actor: "A", key: "Space" },
            ...keys("A", "Test"),
        ]);
        currentHarness.assertPeersEquivalent("strict");
        const a = currentHarness.getPeerSnapshot("A");
        expect(a.normalizedMarkdown).toContain("2. \\# Test");
        expect(JSON.stringify(a.docJson)).not.toContain("\"type\":\"heading\"");
    });

    it("heading input rule syncs for # + Space from peer B with queued duplicate replay", async () => {
        currentHarness = createTwoPeerHarness({
            schedulerMode: "queued",
            duplicateDelivery: true,
        });
        await currentHarness.runSteps([
            ...keys("B", "#"),
            { actor: "B", key: "Space" },
            ...keys("B", "Test"),
        ]);
        currentHarness.flushAll();
        currentHarness.assertPeersEquivalent("strict");
        const b = currentHarness.getPeerSnapshot("B");
        expect(b.normalizedMarkdown).toContain("# Test");
    });

    it("ordered list Enter split increments and converges", async () => {
        currentHarness = createTwoPeerHarness({ schedulerMode: "immediate" });
        await currentHarness.runSteps([
            ...keys("A", "1. one"),
            { actor: "A", key: "Enter" },
            ...keys("A", "two"),
            { actor: "A", key: "Enter" },
            ...keys("A", "three"),
        ]);
        currentHarness.assertPeersEquivalent("strict");
        const a = currentHarness.getPeerSnapshot("A");
        expect(a.normalizedMarkdown).toContain("1. one");
        expect(a.normalizedMarkdown).toContain("2. two");
        expect(a.normalizedMarkdown).toContain("3. three");
    });

    it("empty ordered list item Enter exits list on both peers", async () => {
        currentHarness = createTwoPeerHarness({ schedulerMode: "immediate" });
        await currentHarness.runSteps([
            ...keys("A", "1. one"),
            { actor: "A", key: "Enter" },
            ...keys("A", "two"),
            { actor: "A", key: "Enter" },
            // third item is empty now
            { actor: "A", key: "Enter" },
            ...keys("A", "after"),
        ]);

        currentHarness.assertPeersEquivalent("strict");
        const a = currentHarness.getPeerSnapshot("A");
        expect(a.normalizedMarkdown).toContain("1. one");
        expect(a.normalizedMarkdown).toContain("2. two");
        expect(a.normalizedMarkdown).toContain("after");
        expect(a.normalizedMarkdown).not.toContain("3.");
    });

    it("ordered list + bold markers + Enter stays in sync", async () => {
        currentHarness = createTwoPeerHarness({ schedulerMode: "queued" });
        await currentHarness.runSteps([
            ...keys("A", "1. **bold**"),
            { actor: "A", key: "Enter" },
            ...keys("A", "next"),
            ...keys("B", "x"),
        ]);
        currentHarness.flushAll();
        currentHarness.assertPeersEquivalent("strict");
    });

    it("bullet list create and continue stays in sync", async () => {
        currentHarness = createTwoPeerHarness({ schedulerMode: "immediate" });
        await currentHarness.runSteps([
            ...keys("A", "- "),
            ...keys("A", "item one"),
            { actor: "A", key: "Enter" },
            ...keys("A", "item two"),
        ]);
        currentHarness.assertPeersEquivalent("strict");
        const a = currentHarness.getPeerSnapshot("A");
        expect(a.normalizedMarkdown).toContain("- item one");
    });

    it("mixed middle edits converge across peers", async () => {
        currentHarness = createTwoPeerHarness({
            schedulerMode: "queued",
            duplicateDelivery: true,
            initialMarkdown: "Hello **world**",
        });
        await currentHarness.runSteps([
            { actor: "A", key: "ArrowLeft" },
            { actor: "A", key: "ArrowLeft" },
            ...keys("A", "!!"),
            { actor: "B", key: "Backspace" },
            ...keys("B", "?"),
        ]);
        currentHarness.flushPeer("A");
        currentHarness.flushPeer("B");
        currentHarness.assertPeersEquivalent("semantic");
    });

    it("concurrent boundary edits converge with opposite replay order", async () => {
        currentHarness = createTwoPeerHarness({ schedulerMode: "queued" });
        await currentHarness.runSteps([
            ...keys("A", "1. alpha"),
            { actor: "A", key: "Enter" },
            ...keys("A", "beta"),
            { actor: "B", key: "ArrowLeft" },
            { actor: "B", key: "ArrowLeft" },
            ...keys("B", "!"),
        ]);
        const queued = currentHarness.getQueuedTxIds();
        currentHarness.flushInOrder([...queued].reverse());
        currentHarness.assertPeersEquivalent("strict");
    });

    it("select all then delete clears content on both peers", async () => {
        currentHarness = createTwoPeerHarness({
            schedulerMode: "immediate",
            initialMarkdown: "Hello\n\n1. one\n2. two\n\n**bold**",
        });
        await currentHarness.runSteps([
            { actor: "A", key: "Mod+a" },
            { actor: "A", key: "Backspace" },
        ]);

        currentHarness.assertPeersEquivalent("strict");
        const a = currentHarness.getPeerSnapshot("A");
        expect(a.normalizedMarkdown).toBe("");
    });

    it("select all then forward-delete clears content on both peers", async () => {
        currentHarness = createTwoPeerHarness({
            schedulerMode: "immediate",
            initialMarkdown: "Hello\n\n1. one\n2. two\n\n**bold**",
        });
        await currentHarness.runSteps([
            { actor: "A", key: "Mod+a" },
            { actor: "A", key: "Delete" },
        ]);

        currentHarness.assertPeersEquivalent("strict");
        const a = currentHarness.getPeerSnapshot("A");
        expect(a.normalizedMarkdown).toBe("");
    });
});
