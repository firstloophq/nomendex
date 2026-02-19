export type ClientId = string;

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ID_LENGTH = 16;

export function generateClientId(): ClientId {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    id += CHARS[bytes[i]! % CHARS.length];
  }
  return id;
}
