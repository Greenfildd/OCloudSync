import * as Y from "yjs";

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function replaceText(doc: Y.Doc, nextText: string): void {
  const text = doc.getText("content");
  const current = text.toString();
  if (current === nextText) return;
  let prefix = 0;
  while (prefix < current.length && prefix < nextText.length && current[prefix] === nextText[prefix]) prefix++;
  if (prefix > 0 && /[\uD800-\uDBFF]/.test(current[prefix - 1] ?? "")) prefix--;
  let suffix = 0;
  while (
    suffix < current.length - prefix && suffix < nextText.length - prefix &&
    current[current.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]
  ) suffix++;
  if (suffix > 0 && /[\uDC00-\uDFFF]/.test(current[current.length - suffix] ?? "")) suffix--;
  const deleteLength = current.length - prefix - suffix;
  const insert = nextText.slice(prefix, nextText.length - suffix);
  doc.transact(() => {
    if (deleteLength) text.delete(prefix, deleteLength);
    if (insert) text.insert(prefix, insert);
  });
}

export function createCrdtSeed(text: string): ArrayBuffer {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, text);
  return bufferOf(Y.encodeStateAsUpdate(doc));
}

export function mergeCrdtText(
  updates: ArrayBuffer[],
  localText: string
): { text: string; update: ArrayBuffer } {
  const merged = new Y.Doc();
  for (const update of updates) Y.applyUpdate(merged, new Uint8Array(update));
  const stateVector = Y.encodeStateVector(merged);
  const base = Y.encodeStateAsUpdate(merged);
  const localBranch = new Y.Doc();
  Y.applyUpdate(localBranch, base);
  replaceText(localBranch, localText);
  Y.applyUpdate(merged, Y.encodeStateAsUpdate(localBranch));
  // Yjs updates are idempotent, so the result can safely be retried after an
  // interrupted upload or applied more than once by another device.
  const delta = Y.encodeStateAsUpdate(merged, stateVector);
  return {
    text: merged.getText("content").toString(),
    update: bufferOf(delta),
  };
}

