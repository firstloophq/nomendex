import { describe, expect, it } from "bun:test";
import {
  createItem,
  createItemStore,
  integrateItem,
  deleteItem,
  getVisibleContent,
  getItemById,
  type Item,
} from "@/crdt/core/item";
import { createOperationId } from "@/crdt/core/operations";

function makeId(client: string, clock: number) {
  return createOperationId({ clientId: client, clock });
}

describe("Item", () => {
  it("creates an item with correct fields", () => {
    const item = createItem({
      id: makeId("A", 1),
      leftOrigin: null,
      rightOrigin: null,
      content: { type: "text", value: "h" },
      deleted: false,
    });
    expect(item.id.clientId).toBe("A");
    expect(item.id.clock).toBe(1);
    expect(item.content.type === "text" && item.content.value).toBe("h");
    expect(item.deleted).toBe(false);
    expect(item.leftOrigin).toBeNull();
    expect(item.rightOrigin).toBeNull();
  });
});

describe("ItemStore", () => {
  it("creates an empty store", () => {
    const store = createItemStore();
    expect(store.length).toBe(0);
  });

  it("retrieves item by id after integration", () => {
    let store = createItemStore();
    const item = createItem({
      id: makeId("A", 1),
      leftOrigin: null,
      rightOrigin: null,
      content: { type: "text", value: "a" },
      deleted: false,
    });
    store = integrateItem({ store, item });
    const found = getItemById({ store, id: makeId("A", 1) });
    expect(found).not.toBeNull();
    expect(found!.content.type === "text" && found!.content.value).toBe("a");
  });
});

describe("integrateItem", () => {
  it("inserts a single item into empty store", () => {
    let store = createItemStore();
    const item = createItem({
      id: makeId("A", 1),
      leftOrigin: null,
      rightOrigin: null,
      content: { type: "text", value: "a" },
      deleted: false,
    });
    store = integrateItem({ store, item });
    expect(store.length).toBe(1);
    expect(getVisibleContent({ store })).toBe("a");
  });

  it("inserts B after A → [A, B]", () => {
    let store = createItemStore();
    store = integrateItem({
      store,
      item: createItem({
        id: makeId("A", 1),
        leftOrigin: null,
        rightOrigin: null,
        content: { type: "text", value: "a" },
        deleted: false,
      }),
    });
    store = integrateItem({
      store,
      item: createItem({
        id: makeId("A", 2),
        leftOrigin: makeId("A", 1),
        rightOrigin: null,
        content: { type: "text", value: "b" },
        deleted: false,
      }),
    });
    expect(getVisibleContent({ store })).toBe("ab");
  });

  it("inserts C between A and B → [A, C, B]", () => {
    let store = createItemStore();
    // Insert A
    store = integrateItem({
      store,
      item: createItem({
        id: makeId("A", 1),
        leftOrigin: null,
        rightOrigin: null,
        content: { type: "text", value: "a" },
        deleted: false,
      }),
    });
    // Insert B after A
    store = integrateItem({
      store,
      item: createItem({
        id: makeId("A", 2),
        leftOrigin: makeId("A", 1),
        rightOrigin: null,
        content: { type: "text", value: "b" },
        deleted: false,
      }),
    });
    // Insert C between A and B (left=A, right=B)
    store = integrateItem({
      store,
      item: createItem({
        id: makeId("A", 3),
        leftOrigin: makeId("A", 1),
        rightOrigin: makeId("A", 2),
        content: { type: "text", value: "c" },
        deleted: false,
      }),
    });
    expect(getVisibleContent({ store })).toBe("acb");
  });

  it("concurrent inserts at same position from different clients → deterministic order", () => {
    // Both clients insert after null (at beginning)
    // Client A (id "A") should come before client B (id "B") since "A" < "B"
    let store1 = createItemStore();
    let store2 = createItemStore();

    const itemA = createItem({
      id: makeId("A", 1),
      leftOrigin: null,
      rightOrigin: null,
      content: { type: "text", value: "a" },
      deleted: false,
    });
    const itemB = createItem({
      id: makeId("B", 1),
      leftOrigin: null,
      rightOrigin: null,
      content: { type: "text", value: "b" },
      deleted: false,
    });

    // Apply in order A then B
    store1 = integrateItem({ store: store1, item: itemA });
    store1 = integrateItem({ store: store1, item: itemB });

    // Apply in order B then A
    store2 = integrateItem({ store: store2, item: itemB });
    store2 = integrateItem({ store: store2, item: itemA });

    // Both should produce the same result
    const content1 = getVisibleContent({ store: store1 });
    const content2 = getVisibleContent({ store: store2 });
    expect(content1).toBe(content2);
  });

  it("concurrent inserts at same position: lower clientId wins left position", () => {
    let store = createItemStore();

    // First insert a base item
    store = integrateItem({
      store,
      item: createItem({
        id: makeId("X", 1),
        leftOrigin: null,
        rightOrigin: null,
        content: { type: "text", value: "x" },
        deleted: false,
      }),
    });

    // Client A inserts after X
    const itemA = createItem({
      id: makeId("A", 1),
      leftOrigin: makeId("X", 1),
      rightOrigin: null,
      content: { type: "text", value: "a" },
      deleted: false,
    });

    // Client B also inserts after X (concurrent)
    const itemB = createItem({
      id: makeId("B", 1),
      leftOrigin: makeId("X", 1),
      rightOrigin: null,
      content: { type: "text", value: "b" },
      deleted: false,
    });

    store = integrateItem({ store, item: itemA });
    store = integrateItem({ store, item: itemB });

    // A < B lexicographically, so A should come first
    expect(getVisibleContent({ store })).toBe("xab");
  });

  it("is idempotent — inserting the same item twice has no effect", () => {
    let store = createItemStore();
    const item = createItem({
      id: makeId("A", 1),
      leftOrigin: null,
      rightOrigin: null,
      content: { type: "text", value: "a" },
      deleted: false,
    });
    store = integrateItem({ store, item });
    store = integrateItem({ store, item });
    expect(store.length).toBe(1);
    expect(getVisibleContent({ store })).toBe("a");
  });
});

describe("deleteItem", () => {
  it("marks an item as deleted", () => {
    let store = createItemStore();
    store = integrateItem({
      store,
      item: createItem({
        id: makeId("A", 1),
        leftOrigin: null,
        rightOrigin: null,
        content: { type: "text", value: "a" },
        deleted: false,
      }),
    });
    store = deleteItem({ store, targetId: makeId("A", 1) });
    const item = getItemById({ store, id: makeId("A", 1) });
    expect(item!.deleted).toBe(true);
  });

  it("deleted items are excluded from visible content", () => {
    let store = createItemStore();
    store = integrateItem({
      store,
      item: createItem({
        id: makeId("A", 1),
        leftOrigin: null,
        rightOrigin: null,
        content: { type: "text", value: "a" },
        deleted: false,
      }),
    });
    store = integrateItem({
      store,
      item: createItem({
        id: makeId("A", 2),
        leftOrigin: makeId("A", 1),
        rightOrigin: null,
        content: { type: "text", value: "b" },
        deleted: false,
      }),
    });
    store = integrateItem({
      store,
      item: createItem({
        id: makeId("A", 3),
        leftOrigin: makeId("A", 2),
        rightOrigin: null,
        content: { type: "text", value: "c" },
        deleted: false,
      }),
    });
    // Delete middle item
    store = deleteItem({ store, targetId: makeId("A", 2) });
    expect(getVisibleContent({ store })).toBe("ac");
  });

  it("deleted item remains in the list structure", () => {
    let store = createItemStore();
    store = integrateItem({
      store,
      item: createItem({
        id: makeId("A", 1),
        leftOrigin: null,
        rightOrigin: null,
        content: { type: "text", value: "a" },
        deleted: false,
      }),
    });
    store = deleteItem({ store, targetId: makeId("A", 1) });
    // Item should still exist
    expect(store.length).toBe(1);
    const item = getItemById({ store, id: makeId("A", 1) });
    expect(item).not.toBeNull();
    expect(item!.deleted).toBe(true);
  });

  it("delete is idempotent", () => {
    let store = createItemStore();
    store = integrateItem({
      store,
      item: createItem({
        id: makeId("A", 1),
        leftOrigin: null,
        rightOrigin: null,
        content: { type: "text", value: "a" },
        deleted: false,
      }),
    });
    store = deleteItem({ store, targetId: makeId("A", 1) });
    store = deleteItem({ store, targetId: makeId("A", 1) });
    expect(getVisibleContent({ store })).toBe("");
  });
});

describe("insert into concurrently deleted region", () => {
  it("rightOrigin bounds scanning: insert stays between anchors in deleted region", () => {
    // Client X types "abcde" sequentially
    let store = createItemStore();
    store = integrateItem({ store, item: createItem({ id: makeId("X", 1), leftOrigin: null, rightOrigin: null, content: { type: "text", value: "a" }, deleted: false }) });
    store = integrateItem({ store, item: createItem({ id: makeId("X", 2), leftOrigin: makeId("X", 1), rightOrigin: null, content: { type: "text", value: "b" }, deleted: false }) });
    store = integrateItem({ store, item: createItem({ id: makeId("X", 3), leftOrigin: makeId("X", 2), rightOrigin: null, content: { type: "text", value: "c" }, deleted: false }) });
    store = integrateItem({ store, item: createItem({ id: makeId("X", 4), leftOrigin: makeId("X", 3), rightOrigin: null, content: { type: "text", value: "d" }, deleted: false }) });
    store = integrateItem({ store, item: createItem({ id: makeId("X", 5), leftOrigin: makeId("X", 4), rightOrigin: null, content: { type: "text", value: "e" }, deleted: false }) });

    // Delete b, c, d (concurrent delete by another editor)
    store = deleteItem({ store, targetId: makeId("X", 2) });
    store = deleteItem({ store, targetId: makeId("X", 3) });
    store = deleteItem({ store, targetId: makeId("X", 4) });

    expect(getVisibleContent({ store })).toBe("ae");

    // Client B inserts "x" between b and c — PM plugin gives both anchors:
    // leftOrigin=b(X:2), rightOrigin=c(X:3). Bounded range prevents sliding.
    store = integrateItem({
      store,
      item: createItem({
        id: makeId("B", 10),
        leftOrigin: makeId("X", 2),
        rightOrigin: makeId("X", 3),
        content: { type: "text", value: "x" },
        deleted: false,
      }),
    });

    // x appears at the deletion boundary (between a and e)
    expect(getVisibleContent({ store })).toBe("axe");
  });

  it("multiple chars with rightOrigin stay contiguous in deleted region", () => {
    // Client X types "abcde"
    let store = createItemStore();
    store = integrateItem({ store, item: createItem({ id: makeId("X", 1), leftOrigin: null, rightOrigin: null, content: { type: "text", value: "a" }, deleted: false }) });
    store = integrateItem({ store, item: createItem({ id: makeId("X", 2), leftOrigin: makeId("X", 1), rightOrigin: null, content: { type: "text", value: "b" }, deleted: false }) });
    store = integrateItem({ store, item: createItem({ id: makeId("X", 3), leftOrigin: makeId("X", 2), rightOrigin: null, content: { type: "text", value: "c" }, deleted: false }) });
    store = integrateItem({ store, item: createItem({ id: makeId("X", 4), leftOrigin: makeId("X", 3), rightOrigin: null, content: { type: "text", value: "d" }, deleted: false }) });
    store = integrateItem({ store, item: createItem({ id: makeId("X", 5), leftOrigin: makeId("X", 4), rightOrigin: null, content: { type: "text", value: "e" }, deleted: false }) });

    // Delete "bcd"
    store = deleteItem({ store, targetId: makeId("X", 2) });
    store = deleteItem({ store, targetId: makeId("X", 3) });
    store = deleteItem({ store, targetId: makeId("X", 4) });

    // Client B types "xyz" — PM plugin uses side="left" with rightAnchor=c(X:3),
    // all three chars have leftOrigin=b(X:2), rightOrigin=c(X:3).
    // YATA orders by ascending clock within the bounded range.
    store = integrateItem({ store, item: createItem({ id: makeId("B", 10), leftOrigin: makeId("X", 2), rightOrigin: makeId("X", 3), content: { type: "text", value: "x" }, deleted: false }) });
    store = integrateItem({ store, item: createItem({ id: makeId("B", 11), leftOrigin: makeId("X", 2), rightOrigin: makeId("X", 3), content: { type: "text", value: "y" }, deleted: false }) });
    store = integrateItem({ store, item: createItem({ id: makeId("B", 12), leftOrigin: makeId("X", 2), rightOrigin: makeId("X", 3), content: { type: "text", value: "z" }, deleted: false }) });

    // "xyz" stays contiguous at the boundary
    expect(getVisibleContent({ store })).toBe("axyze");
  });

  it("rightOrigin prevents sliding past sequential chain", () => {
    // Client X types "abc"
    let store = createItemStore();
    store = integrateItem({ store, item: createItem({ id: makeId("X", 1), leftOrigin: null, rightOrigin: null, content: { type: "text", value: "a" }, deleted: false }) });
    store = integrateItem({ store, item: createItem({ id: makeId("X", 2), leftOrigin: makeId("X", 1), rightOrigin: null, content: { type: "text", value: "b" }, deleted: false }) });
    store = integrateItem({ store, item: createItem({ id: makeId("X", 3), leftOrigin: makeId("X", 2), rightOrigin: null, content: { type: "text", value: "c" }, deleted: false }) });

    // Client B inserts "x" between a and b — PM gives leftOrigin=a(X:1), rightOrigin=b(X:2)
    // Range [a+1, b) = empty → x at position 1 (between a and b)
    store = integrateItem({
      store,
      item: createItem({
        id: makeId("B", 10),
        leftOrigin: makeId("X", 1),
        rightOrigin: makeId("X", 2),
        content: { type: "text", value: "x" },
        deleted: false,
      }),
    });

    // x goes between a and b, NOT past the chain
    expect(getVisibleContent({ store })).toBe("axbc");
  });

  it("convergence: both orderings with rightOrigin produce same result", () => {
    // x has leftOrigin=b(X:2), rightOrigin=c(X:3) — bounded insert

    // Order 1: insert first, then delete
    let store1 = createItemStore();
    store1 = integrateItem({ store: store1, item: createItem({ id: makeId("X", 1), leftOrigin: null, rightOrigin: null, content: { type: "text", value: "a" }, deleted: false }) });
    store1 = integrateItem({ store: store1, item: createItem({ id: makeId("X", 2), leftOrigin: makeId("X", 1), rightOrigin: null, content: { type: "text", value: "b" }, deleted: false }) });
    store1 = integrateItem({ store: store1, item: createItem({ id: makeId("X", 3), leftOrigin: makeId("X", 2), rightOrigin: null, content: { type: "text", value: "c" }, deleted: false }) });
    store1 = integrateItem({ store: store1, item: createItem({ id: makeId("B", 10), leftOrigin: makeId("X", 2), rightOrigin: makeId("X", 3), content: { type: "text", value: "x" }, deleted: false }) });
    store1 = deleteItem({ store: store1, targetId: makeId("X", 2) });

    // Order 2: delete first, then insert
    let store2 = createItemStore();
    store2 = integrateItem({ store: store2, item: createItem({ id: makeId("X", 1), leftOrigin: null, rightOrigin: null, content: { type: "text", value: "a" }, deleted: false }) });
    store2 = integrateItem({ store: store2, item: createItem({ id: makeId("X", 2), leftOrigin: makeId("X", 1), rightOrigin: null, content: { type: "text", value: "b" }, deleted: false }) });
    store2 = integrateItem({ store: store2, item: createItem({ id: makeId("X", 3), leftOrigin: makeId("X", 2), rightOrigin: null, content: { type: "text", value: "c" }, deleted: false }) });
    store2 = deleteItem({ store: store2, targetId: makeId("X", 2) });
    store2 = integrateItem({ store: store2, item: createItem({ id: makeId("B", 10), leftOrigin: makeId("X", 2), rightOrigin: makeId("X", 3), content: { type: "text", value: "x" }, deleted: false }) });

    // Both converge — x goes between b and c (bounded by rightOrigin)
    expect(getVisibleContent({ store: store1 })).toBe(getVisibleContent({ store: store2 }));
    expect(getVisibleContent({ store: store1 })).toBe("axc");
  });
});

describe("convergence with random operations", () => {
  it("100 random concurrent inserts resolve consistently regardless of order", () => {
    // Generate items from 3 clients
    const items: Array<Item> = [];
    const clients = ["A", "B", "C"];
    for (let i = 0; i < 100; i++) {
      const client = clients[i % 3]!;
      const clock = Math.floor(i / 3) + 1;
      items.push(
        createItem({
          id: makeId(client, clock),
          leftOrigin: null, // all insert at beginning for conflict resolution stress test
          rightOrigin: null,
          content: { type: "text", value: String(i) },
          deleted: false,
        })
      );
    }

    // Apply in original order
    let store1 = createItemStore();
    for (const item of items) {
      store1 = integrateItem({ store: store1, item });
    }

    // Apply in reverse order
    let store2 = createItemStore();
    for (let i = items.length - 1; i >= 0; i--) {
      store2 = integrateItem({ store: store2, item: items[i]! });
    }

    // Apply in random shuffled order
    let store3 = createItemStore();
    const shuffled = [...items];
    // Simple deterministic shuffle
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (i * 7 + 3) % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    for (const item of shuffled) {
      store3 = integrateItem({ store: store3, item });
    }

    const content1 = getVisibleContent({ store: store1 });
    const content2 = getVisibleContent({ store: store2 });
    const content3 = getVisibleContent({ store: store3 });

    expect(content1).toBe(content2);
    expect(content2).toBe(content3);
  });
});
