import assert from "node:assert/strict";
import test from "node:test";
import { synchronize } from "../src/sync";
import type { FileEntry, SyncBaseline } from "../src/types";

const file = (path: string, mtime: number, size: number): FileEntry => ({
  path,
  mtime,
  size,
  isFolder: false,
});

const oneByte = (value: number): ArrayBuffer => {
  const buffer = new ArrayBuffer(1);
  new Uint8Array(buffer)[0] = value;
  return buffer;
};

test("uploads a new local file and snapshots its actual post-sync metadata", async () => {
  const baseline: Record<string, SyncBaseline> = {};
  const writes: string[] = [];
  const result = await synchronize(
    [file("note.md", 100, 4)],
    [],
    baseline,
    async () => new ArrayBuffer(0),
    async () => new ArrayBuffer(4),
    async (path) => {
      writes.push(path);
    },
    async () => {},
    async () => ({
      localFiles: [file("note.md", 100, 4)],
      remoteFiles: [file("note.md", 120, 4)],
    })
  );
  assert.deepEqual(writes, ["note.md"]);
  assert.equal(result.uploaded, 1);
  assert.deepEqual(baseline["note.md"], {
    local: { mtime: 100, size: 4 },
    remote: { mtime: 120, size: 4 },
  });
});

test("does not overwrite a file changed on both sides", async () => {
  const baseline: Record<string, SyncBaseline> = {
    "note.md": {
      local: { mtime: 100, size: 4 },
      remote: { mtime: 100, size: 4 },
    },
  };
  let writeCount = 0;
  const result = await synchronize(
    [file("note.md", 200, 8)],
    [file("note.md", 300, 12)],
    baseline,
    async () => new ArrayBuffer(12),
    async () => new ArrayBuffer(8),
    async () => {
      writeCount++;
    },
    async () => {
      writeCount++;
    },
    async () => ({
      localFiles: [file("note.md", 200, 8)],
      remoteFiles: [file("note.md", 300, 12)],
    })
  );
  assert.equal(writeCount, 0);
  assert.deepEqual(result.conflicts, ["note.md"]);
  assert.deepEqual(baseline["note.md"], {
    local: { mtime: 100, size: 4 },
    remote: { mtime: 100, size: 4 },
  });
});

test("detects different contents even when first-sync metadata is identical", async () => {
  const baseline: Record<string, SyncBaseline> = {};
  const result = await synchronize(
    [file("note.md", 100, 1)],
    [file("note.md", 100, 1)],
    baseline,
    async () => oneByte(2),
    async () => oneByte(1),
    async () => {
      assert.fail("Conflicting content must not be overwritten");
    },
    async () => {
      assert.fail("Conflicting content must not be overwritten");
    },
    async () => ({
      localFiles: [file("note.md", 100, 1)],
      remoteFiles: [file("note.md", 100, 1)],
    })
  );
  assert.deepEqual(result.conflicts, ["note.md"]);
  assert.equal(baseline["note.md"], undefined);
});

test("pulls a remote-only file", async () => {
  const baseline: Record<string, SyncBaseline> = {};
  const downloaded: string[] = [];
  const result = await synchronize(
    [],
    [file("folder/note.md", 500, 7)],
    baseline,
    async () => new ArrayBuffer(7),
    async () => new ArrayBuffer(0),
    async () => {},
    async (path) => {
      downloaded.push(path);
    },
    async () => ({
      localFiles: [file("folder/note.md", 520, 7)],
      remoteFiles: [file("folder/note.md", 500, 7)],
    })
  );
  assert.deepEqual(downloaded, ["folder/note.md"]);
  assert.equal(result.downloaded, 1);
  assert.deepEqual(baseline["folder/note.md"], {
    local: { mtime: 520, size: 7 },
    remote: { mtime: 500, size: 7 },
  });
});
