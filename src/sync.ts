import type {
  FileEntry,
  FileSignature,
  SyncBaseline,
} from "./types";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export type LocalFile = FileEntry;

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  conflicts: string[];
}

interface EditHunk { start: number; end: number; lines: string[] }

function diffLines(base: string[], changed: string[]): EditHunk[] | undefined {
  const n = base.length;
  const m = changed.length;
  if (n > 2000 || m > 2000 || n * m > 100_000) return undefined;
  const width = m + 1;
  const lcs = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const index = i * width + j;
      lcs[index] = base[i] === changed[j]
        ? 1 + lcs[(i + 1) * width + j + 1]
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  const hunks: EditHunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && base[i] === changed[j]) { i++; j++; continue; }
    const start = i;
    const lines: string[] = [];
    while (i < n || j < m) {
      if (i < n && j < m && base[i] === changed[j]) break;
      if (j < m && (i === n || lcs[i * width + j + 1] >= lcs[(i + 1) * width + j])) lines.push(changed[j++]);
      else i++;
    }
    hunks.push({ start, end: i, lines });
  }
  return hunks;
}

function mergeText(baseText: string, localText: string, remoteText: string): string | undefined {
  if (localText === remoteText) return localText;
  const base = baseText.split("\n");
  const local = diffLines(base, localText.split("\n"));
  const remote = diffLines(base, remoteText.split("\n"));
  if (!local || !remote) return undefined;
  const edits = [...local, ...remote].sort((a, b) => a.start - b.start || a.end - b.end);
  const unique: EditHunk[] = [];
  for (const edit of edits) {
    const previous = unique[unique.length - 1];
    if (previous && previous.start === edit.start && previous.end === edit.end && previous.lines.join("\n") === edit.lines.join("\n")) continue;
    if (previous && (previous.start === edit.start || previous.end > edit.start)) return undefined;
    unique.push(edit);
  }
  const merged: string[] = [];
  let cursor = 0;
  for (const edit of unique) {
    merged.push(...base.slice(cursor, edit.start), ...edit.lines);
    cursor = edit.end;
  }
  merged.push(...base.slice(cursor));
  return merged.join("\n");
}

const signature = (file: FileEntry): FileSignature => ({
  mtime: file.mtime,
  size: file.size,
});

const sameSignature = (a: FileSignature, b: FileSignature): boolean =>
  a.mtime === b.mtime && a.size === b.size;

async function sameContent(path: string, readLocal: (path: string) => Promise<ArrayBuffer>, readRemote: (path: string) => Promise<ArrayBuffer>): Promise<boolean> {
  const [local, remote] = await Promise.all([readLocal(path), readRemote(path)]);
  if (local.byteLength !== remote.byteLength) {
    return false;
  }
  const localBytes = new Uint8Array(local);
  const remoteBytes = new Uint8Array(remote);
  return localBytes.every((value, index) => value === remoteBytes[index]);
}

async function runConcurrent<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  let failure: unknown;
  const workerCount = Math.min(items.length, Math.max(1, Math.min(20, Math.floor(concurrency) || 1)));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (failure === undefined) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        await task(items[index]);
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
      }
    }
  }));
  if (failure instanceof Error) throw failure;
}

export async function synchronize(
  localFiles: LocalFile[],
  remoteFiles: FileEntry[],
  baseline: Record<string, SyncBaseline>,
  readRemote: (path: string) => Promise<ArrayBuffer>,
  readLocal: (path: string) => Promise<ArrayBuffer>,
  writeRemote: (
    path: string,
    data: ArrayBuffer,
    mtime: number
  ) => Promise<void>,
  writeLocal: (path: string, data: ArrayBuffer) => Promise<void>,
  refresh: () => Promise<{ localFiles: LocalFile[]; remoteFiles: FileEntry[] }>,
  conflictAction: "keep-newer" | "keep-larger" | "keep-both" | "merge-markdown" | "crdt" = "keep-newer",
  deleteRemote?: (path: string) => Promise<void>,
  deleteLocal?: (path: string) => Promise<void>,
  syncDeletions = true,
  shouldCancel: () => boolean = () => false,
  concurrency = 5
): Promise<SyncResult> {
  const localByPath = new Map(localFiles.map((file) => [file.path, file]));
  const remoteByPath = new Map(remoteFiles.map((file) => [file.path, file]));
  const paths = new Set([...localByPath.keys(), ...remoteByPath.keys()]);
  const conflictedPaths = new Set<string>();
  const result: SyncResult = { uploaded: 0, downloaded: 0, conflicts: [] };

  const preserveBoth = async (path: string): Promise<void> => {
    const [localData, remoteData] = await Promise.all([readLocal(path), readRemote(path)]);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const slash = path.lastIndexOf("/");
    const dot = path.lastIndexOf(".");
    const insertAt = dot > slash ? dot : path.length;
    const localCopy = `${path.slice(0, insertAt)}.conflict-local-${stamp}${path.slice(insertAt)}`;
    const remoteCopy = `${path.slice(0, insertAt)}.conflict-remote-${stamp}${path.slice(insertAt)}`;
    await writeRemote(localCopy, localData, Date.now());
    await writeLocal(remoteCopy, remoteData);
    await writeLocal(path, remoteData);
    result.uploaded++;
    result.downloaded += 2;
  };

  const tryMergeMarkdown = async (path: string, baseContent?: string): Promise<boolean> => {
    if (!path.toLowerCase().endsWith(".md") || baseContent === undefined || baseContent.length > 16_000) return false;
    const [localData, remoteData] = await Promise.all([readLocal(path), readRemote(path)]);
    if (localData.byteLength > 16_384 || remoteData.byteLength > 16_384) return false;
    let localText: string;
    let remoteText: string;
    try {
      localText = new TextDecoder("utf-8", { fatal: true }).decode(localData);
      remoteText = new TextDecoder("utf-8", { fatal: true }).decode(remoteData);
    } catch { return false; }
    const merged = mergeText(baseContent, localText, remoteText);
    if (merged === undefined) return false;
    const bytes = new TextEncoder().encode(merged);
    const buffer = toArrayBuffer(bytes);
    await writeRemote(path, buffer, Date.now());
    await writeLocal(path, buffer);
    result.uploaded++;
    result.downloaded++;
    return true;
  };

  await runConcurrent([...paths], concurrency, async (path) => {
    if (shouldCancel()) throw new Error("SYNC_CANCELLED");
    const local = localByPath.get(path);
    const remote = remoteByPath.get(path);

    if (local && !remote) {
      const previous = baseline[path];
      if (syncDeletions && previous && sameSignature(signature(local), previous.local) && deleteLocal) {
        await deleteLocal(path);
        return;
      }
      await writeRemote(path, await readLocal(path), local.mtime);
      result.uploaded++;
      return;
    }

    if (!local && remote) {
      const previous = baseline[path];
      if (syncDeletions && previous && sameSignature(signature(remote), previous.remote) && deleteRemote) {
        await deleteRemote(path);
        return;
      }
      await writeLocal(path, await readRemote(path));
      result.downloaded++;
      return;
    }

    if (!local || !remote) {
      return;
    }

    const localSignature = signature(local);
    const remoteSignature = signature(remote);
    const previous = baseline[path];

    if (
      previous &&
      sameSignature(localSignature, previous.local) &&
      sameSignature(remoteSignature, previous.remote)
    ) {
      return;
    }

    if (sameSignature(localSignature, remoteSignature)) {
      if (await sameContent(path, readLocal, readRemote)) {
        return;
      }
      if (conflictAction === "merge-markdown" && await tryMergeMarkdown(path, baseline[path]?.baseContent)) return;
      if (conflictAction === "merge-markdown") { await preserveBoth(path); return; }
      if (conflictAction === "keep-both") {
        await preserveBoth(path);
        return;
      }
      result.conflicts.push(path);
      conflictedPaths.add(path);
      return;
    }

    if (previous) {
      const localChanged = !sameSignature(localSignature, previous.local);
      const remoteChanged = !sameSignature(remoteSignature, previous.remote);

      if (localChanged && !remoteChanged) {
        await writeRemote(path, await readLocal(path), local.mtime);
        result.uploaded++;
      } else if (remoteChanged && !localChanged) {
        await writeLocal(path, await readRemote(path));
        result.downloaded++;
      } else if (conflictAction === "keep-larger" && local.size !== remote.size) {
        if (local.size > remote.size) {
          await writeRemote(path, await readLocal(path), local.mtime);
          result.uploaded++;
        } else {
          await writeLocal(path, await readRemote(path));
          result.downloaded++;
        }
      } else if (conflictAction === "keep-newer" && local.mtime !== remote.mtime) {
        if (local.mtime > remote.mtime) {
          await writeRemote(path, await readLocal(path), local.mtime);
          result.uploaded++;
        } else {
          await writeLocal(path, await readRemote(path));
          result.downloaded++;
        }
      } else if (conflictAction === "keep-both") {
        await preserveBoth(path);
      } else if (conflictAction === "merge-markdown") {
        if (!await tryMergeMarkdown(path, previous.baseContent)) await preserveBoth(path);
      } else {
        result.conflicts.push(path);
        conflictedPaths.add(path);
      }
      return;
    }

    if (conflictAction === "keep-both") {
      await preserveBoth(path);
    } else if (local.mtime > remote.mtime) {
      await writeRemote(path, await readLocal(path), local.mtime);
      result.uploaded++;
    } else if (remote.mtime > local.mtime) {
      await writeLocal(path, await readRemote(path));
      result.downloaded++;
    } else if (conflictAction === "keep-larger" && local.size !== remote.size) {
      if (local.size > remote.size) {
        await writeRemote(path, await readLocal(path), local.mtime);
        result.uploaded++;
      } else {
        await writeLocal(path, await readRemote(path));
        result.downloaded++;
      }
    } else {
      result.conflicts.push(path);
      conflictedPaths.add(path);
    }
  });

  if (shouldCancel()) throw new Error("SYNC_CANCELLED");

  const refreshed = await refresh();
  const refreshedLocal = new Map(
    refreshed.localFiles.map((file) => [file.path, file])
  );
  const refreshedRemote = new Map(
    refreshed.remoteFiles.map((file) => [file.path, file])
  );
  const pathsAfterSync = new Set([
    ...refreshedLocal.keys(),
    ...refreshedRemote.keys(),
  ]);
  const nextBaseline: Record<string, SyncBaseline> = {};
  let storedMergeBaseBytes = 0;
  for (const path of [...pathsAfterSync].sort()) {
    if (conflictedPaths.has(path)) {
      if (baseline[path]) {
        nextBaseline[path] = baseline[path];
      }
      continue;
    }
    const local = refreshedLocal.get(path);
    const remote = refreshedRemote.get(path);
    if (local && remote) {
      const next: SyncBaseline = {
        local: signature(local),
        remote: signature(remote),
      };
      if (path.toLowerCase().endsWith(".md") && local.size <= 16_384 && storedMergeBaseBytes + local.size <= 512 * 1024) {
        try {
          const bytes = await readLocal(path);
          next.baseContent = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          storedMergeBaseBytes += bytes.byteLength;
        } catch { /* Keep signature-only baseline for unreadable or binary files. */ }
      }
      nextBaseline[path] = next;
    }
  }

  for (const path of Object.keys(baseline)) {
    delete baseline[path];
  }
  Object.assign(baseline, nextBaseline);
  return result;
}
