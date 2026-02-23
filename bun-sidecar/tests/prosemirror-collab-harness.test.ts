import { afterEach, describe, expect, it } from "bun:test";
import { createTwoPeerHarness, type ScenarioStep } from "./harness/pm-collab-harness";

const toKeys = (text: string) => Array.from(text);
const asPeerASteps = (keys: string[]): ScenarioStep[] =>
    keys.map((key) => ({ actor: "A", key }));

describe("prosemirror collab harness", () => {
    let currentHarness: ReturnType<typeof createTwoPeerHarness> | null = null;

    afterEach(() => {
        currentHarness?.destroy();
        currentHarness = null;
    });

    it("keeps peers equivalent for immediate scheduling", async () => {
        currentHarness = createTwoPeerHarness({ schedulerMode: "immediate" });
        await currentHarness.runSteps([
            ...asPeerASteps([...toKeys("1. "), ...toKeys("alpha")]),
            { actor: "A", key: "Enter" },
            ...asPeerASteps(toKeys("beta")),
        ]);

        currentHarness.assertPeersEquivalent("strict");
        const a = currentHarness.getPeerSnapshot("A");
        expect(a.normalizedMarkdown).toContain("1. alpha");
    });

    it("supports queued flush and ordered replay", async () => {
        currentHarness = createTwoPeerHarness({ schedulerMode: "queued" });
        await currentHarness.runSteps([
            { actor: "A", key: "#" },
            { actor: "A", key: "#" },
            { actor: "A", key: "Space" },
            { actor: "A", key: "T" },
            { actor: "B", key: "x" },
        ]);
        expect(currentHarness.getQueuedTxIds().length).toBeGreaterThan(0);

        const queue = currentHarness.getQueuedTxIds();
        currentHarness.flushInOrder([...queue].reverse());
        currentHarness.assertPeersEquivalent("semantic");
    });

    it("converges under duplicate delivery", async () => {
        currentHarness = createTwoPeerHarness({
            schedulerMode: "queued",
            duplicateDelivery: true,
        });
        await currentHarness.runSteps(
            ["-", "Space", "a", "b", "c"].map((key) => ({ actor: "A" as const, key }))
        );
        currentHarness.flushAll();
        currentHarness.assertPeersEquivalent("strict");
    });
});
