import type { Operation } from "../core/operations";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeOperations(params: {
  ops: ReadonlyArray<Operation>;
}): Uint8Array {
  const json = JSON.stringify(params.ops);
  return encoder.encode(json);
}

export function decodeOperations(params: { data: Uint8Array }): Array<Operation> {
  const json = decoder.decode(params.data);
  const parsed = JSON.parse(json) as Array<Operation>;
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid encoded operations: expected array");
  }
  return parsed;
}
