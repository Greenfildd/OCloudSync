import {
  Notice,
  Modal,
  Plugin,
  PluginSettingTab,
  Platform,
  Setting,
  TFile,
} from "obsidian";
import { connectBox, connectDropbox, connectGoogleDrive, connectOneDrive, createProvider } from "./providers";
import { synchronize, type LocalFile } from "./sync";
import { decryptFile, decryptPath, encryptFileWithMethod, encryptPath } from "./encryption";
import { createCrdtSeed, mergeCrdtText } from "./crdt";
import { DEFAULT_SETTINGS, type PluginSettings } from "./types";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export default class MyCloudSyncPlugin extends Plugin {
  settings!: PluginSettings;
  private isSyncing = false;
  private syncToggleButton?: {
    setButtonText: (text: string) => unknown;
    setCta: () => unknown;
    removeCta: () => unknown;
  };
  private cancelSyncRequested = false;
  private syncPending = false;
  private syncDebounceId: number | null = null;
  private scheduledSyncId: number | null = null;
  private logPersistTimeout: number | null = null;
  private logTextArea?: HTMLTextAreaElement;

  async onload(): Promise<void> {
    const stored: unknown = await this.loadData();
    const saved =
      stored && typeof stored === "object"
        ? (stored as Partial<PluginSettings>)
        : {};
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      remoteFolder:
        typeof saved.remoteFolder === "string"
          ? saved.remoteFolder
          : `Obsidian/${this.app.vault.getName()}`,
      baseline:
        saved.baseline && typeof saved.baseline === "object"
          ? saved.baseline
          : {},
      syncOnSave: saved.syncOnSave !== false,
      scheduledSync: saved.scheduledSync === true,
      scheduledSyncMinutes: this.validInterval(saved.scheduledSyncMinutes),
      maxFileSizeMb: this.validMaxSize(saved.maxFileSizeMb),
      ignorePatterns: typeof saved.ignorePatterns === "string" ? saved.ignorePatterns : "",
      includeUnderscorePaths: saved.includeUnderscorePaths === true,
      syncConfigFolder: saved.syncConfigFolder === true,
      syncBookmarks: saved.syncBookmarks === true,
      conflictAction: saved.conflictAction === "keep-larger" || saved.conflictAction === "keep-both" || saved.conflictAction === "merge-markdown" || saved.conflictAction === "crdt" || saved.conflictAction === "prefer-local" ? saved.conflictAction : "keep-newer",
      deviceId: typeof saved.deviceId === "string" && saved.deviceId ? saved.deviceId : crypto.randomUUID(),
      oneDriveFullAccess: saved.oneDriveFullAccess === true,
      encryptionPassword: typeof saved.encryptionPassword === "string" ? saved.encryptionPassword : "",
      encryptionMethod: saved.encryptionMethod === "openssl-aes-cbc" ? "openssl-aes-cbc" : "aes-gcm",
      encryptionMethodTarget: saved.encryptionMethodTarget === "openssl-aes-cbc" ? "openssl-aes-cbc" : "aes-gcm",
      syncDeletions: saved.syncDeletions !== false,
      syncDeleteLocation: saved.syncDeleteLocation === "system" ? "system" : "obsidian",
      syncConcurrency: this.validConcurrency(saved.syncConcurrency, Platform.isMobile ? 2 : 5),
      syncRecoveryPending: saved.syncRecoveryPending === true,
      ribbonAction: saved.ribbonAction === "settings" ? "settings" : "sync",
      logText: typeof saved.logText === "string" ? saved.logText.split("\n").slice(-500).join("\n") : "",
    };

    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: () => this.syncNow(true),
    });
    this.addCommand({ id: "cancel-sync", name: "Cancel cloud sync", callback: () => this.cancelSync() });
    this.addCommand({ id: "emergency-stop-sync", name: "Emergency stop cloud sync", callback: () => this.cancelSync() });
    this.addRibbonIcon("cloud", "My Cloud Sync", () => {
      if (this.settings.ribbonAction === "settings") this.openPluginSettings();
      else void this.syncNow(true);
    });
    this.addSettingTab(new MyCloudSyncSettingTab(this.app, this));
    this.registerEvent(this.app.vault.on("create", () => this.scheduleSync()));
    // A vault modify event is emitted for every save. Debouncing these events
    // lets the current document reach disk, then starts one sync promptly.
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof TFile && this.shouldSync(file.path, file.stat.size)) {
        this.scheduleSync(this.settings.syncOnSave);
      }
    }));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleSync()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleSync()));
    this.register(() => {
      if (this.syncDebounceId !== null) {
        window.clearTimeout(this.syncDebounceId);
      }
      if (this.scheduledSyncId !== null) window.clearInterval(this.scheduledSyncId);
      if (this.logPersistTimeout !== null) window.clearTimeout(this.logPersistTimeout);
      void this.saveSettings();
    });
    this.refreshScheduledSync();
    if (this.settings.syncRecoveryPending) {
      new Notice("An interrupted sync was found. Resuming cloud sync…");
      window.setTimeout(() => void this.syncNow(), 1200);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async exportSettingsFile(): Promise<void> {
    const payload = {
      format: "OCloudSync settings",
      formatVersion: 1,
      pluginVersion: this.manifest.version,
      exportedAt: new Date().toISOString(),
      settings: {
        ...this.settings,
        deviceId: "",
        baseline: {},
        logText: "",
        syncRecoveryPending: false,
      },
    };
    const content = JSON.stringify(payload, null, 2);
    const safeVaultName = this.app.vault.getName().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "vault";
    const date = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `OCloudSync-${safeVaultName}-settings-${date}.json`;
    const file = new File([content], fileName, { type: "application/json" });

    if (Platform.isMobile && navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "OCloudSync settings export" });
    } else {
      const url = URL.createObjectURL(file);
      const anchor = document.body.createEl("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.addClass("ocs-hidden-download");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
    this.addLog("Settings exported to a JSON file.");
  }

  async importSettingsFile(file: File): Promise<void> {
    if (this.isSyncing) throw new Error("Stop the current sync before importing settings.");
    if (file.size > 2 * 1024 * 1024) throw new Error("The settings file is unexpectedly large (over 2 MB).");
    const payload = JSON.parse(await file.text()) as { format?: unknown; formatVersion?: unknown; settings?: unknown };
    if (payload?.format !== "OCloudSync settings" || payload.formatVersion !== 1) {
      throw new Error("This is not a supported OCloudSync settings export.");
    }
    if (!payload.settings || typeof payload.settings !== "object" || Array.isArray(payload.settings)) {
      throw new Error("The export does not contain a valid settings object.");
    }
    const source = payload.settings as Record<string, unknown>;
    const imported = { ...DEFAULT_SETTINGS };
    const target = imported as unknown as Record<string, unknown>;
    for (const [key, defaultValue] of Object.entries(DEFAULT_SETTINGS)) {
      if (["baseline", "logText", "syncRecoveryPending", "deviceId"].includes(key)) continue;
      const value = source[key];
      if (typeof defaultValue === "string" && typeof value === "string") target[key] = value;
      else if (typeof defaultValue === "number" && typeof value === "number" && Number.isFinite(value)) target[key] = value;
      else if (typeof defaultValue === "boolean" && typeof value === "boolean") target[key] = value;
    }
    const providers = ["webdav", "google-drive", "s3", "azure-blob", "dropbox", "onedrive", "yandex-disk", "pcloud", "webdis", "box"];
    const conflictActions = ["keep-newer", "keep-larger", "keep-both", "merge-markdown", "crdt", "prefer-local"];
    imported.provider = providers.includes(String(source.provider)) ? source.provider as PluginSettings["provider"] : DEFAULT_SETTINGS.provider;
    imported.deviceId = this.settings.deviceId;
    imported.conflictAction = conflictActions.includes(String(source.conflictAction)) ? source.conflictAction as PluginSettings["conflictAction"] : DEFAULT_SETTINGS.conflictAction;
    imported.encryptionMethod = source.encryptionMethod === "openssl-aes-cbc" ? "openssl-aes-cbc" : "aes-gcm";
    imported.encryptionMethodTarget = source.encryptionMethodTarget === "openssl-aes-cbc" ? "openssl-aes-cbc" : "aes-gcm";
    imported.pcloudRegion = source.pcloudRegion === "eu" ? "eu" : "us";
    imported.syncDeleteLocation = source.syncDeleteLocation === "system" ? "system" : "obsidian";
    imported.ribbonAction = source.ribbonAction === "settings" ? "settings" : "sync";
    imported.scheduledSyncMinutes = this.validInterval(source.scheduledSyncMinutes);
    imported.maxFileSizeMb = this.validMaxSize(source.maxFileSizeMb);
    imported.syncConcurrency = this.validConcurrency(source.syncConcurrency, Platform.isMobile ? 2 : 5);
    imported.baseline = {};
    imported.logText = this.settings.logText;
    imported.syncRecoveryPending = false;

    const previous = this.settings;
    this.settings = imported;
    try {
      await this.saveSettings();
    } catch (error) {
      this.settings = previous;
      throw error;
    }
    this.refreshScheduledSync();
    this.addLog(`Settings imported from ${file.name}; sync history was reset.`);
  }

  addLog(message: string, level: "INFO" | "WARN" | "ERROR" = "INFO"): void {
    const cleanMessage = message.replace(/[\r\n]+/g, " ").trim();
    const line = `[${new Date().toLocaleString()}] [${level}] ${cleanMessage}`;
    this.settings.logText = [...this.settings.logText.split("\n").filter(Boolean), line].slice(-500).join("\n");
    if (this.logTextArea?.isConnected) {
      this.logTextArea.value = this.settings.logText;
      this.logTextArea.scrollTop = this.logTextArea.scrollHeight;
    }
    if (this.logPersistTimeout !== null) window.clearTimeout(this.logPersistTimeout);
    this.logPersistTimeout = window.setTimeout(() => {
      this.logPersistTimeout = null;
      void this.saveSettings().catch((error) => console.error("Could not persist plugin log", error));
    }, 800);
  }

  setLogView(textarea?: HTMLTextAreaElement): void {
    this.logTextArea = textarea;
  }

  validInterval(value: unknown): number {
    const options = [2, 5, 10, 20, 30];
    if (typeof value !== "number" || !Number.isFinite(value)) return 30;
    return options.reduce((closest, option) => Math.abs(option - value) < Math.abs(closest - value) ? option : closest, options[0]);
  }

  validMaxSize(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(102400, value)) : 0;
  }

  validConcurrency(value: unknown, fallback = 5): number {
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(1, Math.min(20, Math.floor(value)))
      : fallback;
  }

  refreshScheduledSync(): void {
    if (this.scheduledSyncId !== null) window.clearInterval(this.scheduledSyncId);
    this.scheduledSyncId = null;
    if (this.settings.scheduledSync) {
      this.scheduledSyncId = window.setInterval(() => {
        if (!this.isSyncing) void this.syncNow();
      }, this.settings.scheduledSyncMinutes * 60_000);
    }
  }

  private shouldSync(path: string, size: number): boolean {
    if (path.startsWith(".trash/") || path === ".trash") return false;
    const configDir = this.app.vault.configDir;
    if (path === `${configDir}/bookmarks.json`) return this.settings.syncBookmarks;
    if (path.startsWith(`${configDir}/`) || path === configDir) return this.settings.syncConfigFolder;
    if (path.split("/").some((part) => part.startsWith("."))) return false;
    if (!this.settings.includeUnderscorePaths && path.split("/").some((part) => part.startsWith("_"))) return false;
    const limit = this.settings.maxFileSizeMb * 1024 * 1024;
    const encryptionOverhead = this.settings.encryptionPassword ? 48 : 0;
    if (limit > 0 && size > limit + encryptionOverhead) return false;
    for (const raw of this.settings.ignorePatterns.split(/\r?\n/)) {
      const pattern = raw.trim();
      if (!pattern) continue;
      try {
        if (new RegExp(pattern).test(path)) return false;
      } catch (error) {
        console.warn(`Ignoring invalid sync exclusion pattern: ${pattern}`, error);
      }
    }
    return true;
  }

  async setAutoSync(enabled: boolean): Promise<void> {
    this.settings.autoSync = enabled;
    if (!enabled) {
      this.syncPending = false;
      if (this.syncDebounceId !== null) {
        window.clearTimeout(this.syncDebounceId);
        this.syncDebounceId = null;
      }
    }
    await this.saveSettings();
  }

  private scheduleSync(force = false): void {
    if (!this.settings.autoSync && !force) {
      return;
    }
    if (this.isSyncing) {
      this.syncPending = true;
      return;
    }
    if (this.syncDebounceId !== null) {
      window.clearTimeout(this.syncDebounceId);
    }
    this.syncDebounceId = window.setTimeout(() => {
      this.syncDebounceId = null;
      void this.syncNow();
    }, 250);
  }

  private async getLocalFiles(): Promise<LocalFile[]> {
    return this.app.vault
      .getFiles()
      .filter((file) => this.shouldSync(file.path, file.stat.size))
      .map((file) => ({
        path: file.path,
        mtime: file.stat.mtime,
        size: file.stat.size,
        isFolder: false,
      }));
  }

  private async readLocal(path: string): Promise<ArrayBuffer> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`Local file disappeared during sync: ${path}`);
    }
    return this.app.vault.readBinary(file);
  }

  private async writeLocal(path: string, data: ArrayBuffer): Promise<void> {
    if (
      path.startsWith("/") ||
      path.split("/").some((segment) => segment === "." || segment === "..") ||
      !this.shouldSync(path, data.byteLength)
    ) {
      throw new Error(`Refusing to write an unsafe vault path: ${path}`);
    }
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, data);
    } else if (existing) {
      throw new Error(`A folder already exists at the remote file path: ${path}`);
    } else {
      const segments = path.split("/");
      let folderPath = "";
      for (const segment of segments.slice(0, -1)) {
        folderPath = folderPath ? `${folderPath}/${segment}` : segment;
        if (!this.app.vault.getAbstractFileByPath(folderPath)) {
          await this.app.vault.createFolder(folderPath);
        }
      }
      await this.app.vault.createBinary(path, data);
    }
  }

  async syncNow(manual = false): Promise<void> {
    if (this.isSyncing) {
      new Notice("A cloud sync is already running.");
      return;
    }
    this.cancelSyncRequested = false;
    if (this.syncDebounceId !== null) {
      window.clearTimeout(this.syncDebounceId);
      this.syncDebounceId = null;
    }
    this.isSyncing = true;
    this.updateSyncToggleButton();
    new Notice("Cloud sync started.");
    this.addLog(`Sync started${manual ? " (manual)" : " (automatic)"}.`);
    this.settings.syncRecoveryPending = true;
    let completed = false;
    try {
      await this.saveSettings();
      const provider = createProvider(this.settings);
      const password = this.settings.encryptionPassword;
      const existingRemotePaths = new Map<string, string>();
      const remotePath = (path: string) => password ? encryptPath(path, password, this.settings.encryptionMethod) : Promise.resolve(path);
      const listRemote = async () => {
        const files = await provider.list();
        const mapped = await Promise.all(files.map(async (file) => {
          const path = password ? await decryptPath(file.path, password) : file.path;
          existingRemotePaths.set(path, file.path);
          return { ...file, path };
        }));
        return mapped;
      };
      const readRemoteData = async (path: string) => {
        const remoteData = await provider.read(existingRemotePaths.get(path) ?? await remotePath(path));
        return password ? decryptFile(remoteData, password) : remoteData;
      };
      const writeRemoteData = async (path: string, data: ArrayBuffer, mtime: number) => {
        const oldPath = existingRemotePaths.get(path);
        const encryptedPath = await remotePath(path);
        await provider.write(encryptedPath, password ? await encryptFileWithMethod(data, password, this.settings.encryptionMethod) : data, mtime);
        if (password && oldPath && oldPath !== encryptedPath) await provider.delete(oldPath);
        existingRemotePaths.set(path, encryptedPath);
      };
      const deleteRemoteData = async (path: string) => provider.delete(existingRemotePaths.get(path) ?? await remotePath(path));
      const localFiles = await this.getLocalFiles();
      const allRemoteFiles = await listRemote();
      if (this.settings.conflictAction === "prefer-local") {
        const primaryPath = ".ocs-system/primary-device.json";
        const markerExists = allRemoteFiles.some((file) => file.path === primaryPath);
        let primary: { deviceId?: unknown } | undefined;
        if (markerExists) {
          try {
            const remoteData = await provider.read(await remotePath(primaryPath));
            const markerData = password ? await decryptFile(remoteData, password) : remoteData;
            primary = JSON.parse(new TextDecoder().decode(markerData)) as { deviceId?: unknown };
          } catch {
            throw new Error("Cannot verify the primary device marker. Resolve the cloud marker before using Prefer this device.");
          }
          if (primary.deviceId !== this.settings.deviceId) {
            throw new Error("Another device is already designated as primary. Only that device may use Prefer this device.");
          }
        } else {
          const marker = new TextEncoder().encode(JSON.stringify({ deviceId: this.settings.deviceId, claimedAt: Date.now() }));
          const markerBuffer = toArrayBuffer(marker);
          const encryptedMarker = password ? await encryptFileWithMethod(markerBuffer, password, this.settings.encryptionMethod) : markerBuffer;
          await provider.write(await remotePath(primaryPath), encryptedMarker, Date.now());
          const verificationData = await provider.read(await remotePath(primaryPath));
          const plainVerification = password ? await decryptFile(verificationData, password) : verificationData;
          primary = JSON.parse(new TextDecoder().decode(plainVerification)) as { deviceId?: unknown };
          if (primary.deviceId !== this.settings.deviceId) {
            throw new Error("Another device claimed primary status at the same time. This device is not primary.");
          }
        }
      }
      const remoteFiles = allRemoteFiles.filter((file) => this.shouldSync(file.path, file.size));
      this.addLog(`Found ${localFiles.length} local and ${remoteFiles.length} remote files to compare.`);
      const localByPath = new Map(localFiles.map((file) => [file.path, file]));
      const remoteByPath = new Map(remoteFiles.map((file) => [file.path, file]));
      const knownPaths = Object.keys(this.settings.baseline);
      const changedKnownFiles = knownPaths.filter((path) => {
        const previous = this.settings.baseline[path];
        const local = localByPath.get(path);
        const remote = remoteByPath.get(path);
        if (!local && !remote) return false;
        if (!local || !remote) return true;
        return local.mtime !== previous.local.mtime || local.size !== previous.local.size ||
          remote.mtime !== previous.remote.mtime || remote.size !== previous.remote.size;
      }).length;
      if (knownPaths.length > 0 && changedKnownFiles * 2 >= knownPaths.length) {
        const warning = `This sync may change or remove ${changedKnownFiles} of ${knownPaths.length} previously synced files. Continue?`;
        if (!manual) {
          this.settings.syncRecoveryPending = false;
          throw new Error("SYNC_PROTECTED");
        }
        const confirmed = await new Promise<boolean>((resolve) => {
          new ConfirmModal(this.app, warning, () => resolve(true), () => resolve(false)).open();
        });
        if (!confirmed) throw new Error("SYNC_PROTECTED");
      }
      const crdtPrefix = async (path: string) => {
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path)));
        let binary = "";
        for (const byte of digest) binary += String.fromCharCode(byte);
        const hash = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
        return `.my-cloud-sync-crdt/${hash}/`;
      };
      const crdtManagedPaths = new Set<string>();
      for (const remote of remoteFiles) {
        const path = remote.path;
        if (this.settings.conflictAction !== "crdt" || !path.toLowerCase().endsWith(".md") || !localByPath.has(path)) continue;
        if (this.cancelSyncRequested) throw new Error("SYNC_CANCELLED");
        const prefix = await crdtPrefix(path);
        let stateFiles = allRemoteFiles.filter((file) => file.path.startsWith(prefix));
        const localText = new TextDecoder("utf-8", { fatal: true }).decode(await this.readLocal(path));
        if (!stateFiles.length) {
          const remoteText = new TextDecoder("utf-8", { fatal: true }).decode(await readRemoteData(path));
          const seedPath = `${prefix}${crypto.randomUUID()}.yjs`;
          await writeRemoteData(seedPath, createCrdtSeed(remoteText), Date.now());
          existingRemotePaths.set(seedPath, await remotePath(seedPath));
          stateFiles = [{ path: seedPath, size: 0, mtime: Date.now(), isFolder: false }];
        }
        const updates = await Promise.all(stateFiles.map(async (stateFile) => {
          const encryptedUpdate = await provider.read(existingRemotePaths.get(stateFile.path) ?? await remotePath(stateFile.path));
          return password ? decryptFile(encryptedUpdate, password) : encryptedUpdate;
        }));
        const merged = mergeCrdtText(updates, localText);
        if (merged.update.byteLength > 2) {
          const updatePath = `${prefix}${crypto.randomUUID()}.yjs`;
          await writeRemoteData(updatePath, merged.update, Date.now());
        }
        const mergedBytes = new TextEncoder().encode(merged.text);
        const mergedBuffer = toArrayBuffer(mergedBytes);
        if (merged.text !== localText) await this.writeLocal(path, mergedBuffer);
        const remoteText = new TextDecoder("utf-8", { fatal: true }).decode(await readRemoteData(path));
        if (merged.text !== remoteText) await writeRemoteData(path, mergedBuffer, Date.now());
        crdtManagedPaths.add(path);
      }
      const result = await synchronize(
        localFiles.filter((file) => !crdtManagedPaths.has(file.path)),
        remoteFiles.filter((file) => !crdtManagedPaths.has(file.path)),
        this.settings.baseline,
        readRemoteData,
        (path) => this.readLocal(path),
        writeRemoteData,
        (path, data) => this.writeLocal(path, data),
        async () => ({
          localFiles: await this.getLocalFiles(),
          remoteFiles: (await listRemote()).filter((file) => this.shouldSync(file.path, file.size)),
        }),
        this.settings.conflictAction,
        deleteRemoteData,
        async (path) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) await this.app.fileManager.trashFile(file);
        },
        this.settings.syncDeletions,
        () => this.cancelSyncRequested,
        Platform.isMobile ? Math.min(this.settings.syncConcurrency, 3) : this.settings.syncConcurrency
      );
      if (this.settings.conflictAction === "crdt") {
        // Bootstrap CRDT state only for Markdown files that have converged to an
        // identical local and remote value. Other file types keep file-level sync.
        const refreshedRemote = await listRemote();
        const refreshedRemoteFiles = refreshedRemote.filter((file) => this.shouldSync(file.path, file.size));
        const refreshedLocalFiles = await this.getLocalFiles();
        const refreshedLocalByPath = new Map(refreshedLocalFiles.map((file) => [file.path, file]));
        for (const remote of refreshedRemoteFiles) {
          const path = remote.path;
          if (!path.toLowerCase().endsWith(".md") || !refreshedLocalByPath.has(path)) continue;
          const prefix = await crdtPrefix(path);
          if (refreshedRemote.some((file) => file.path.startsWith(prefix))) continue;
          if (this.cancelSyncRequested) throw new Error("SYNC_CANCELLED");
          const localData = await this.readLocal(path);
          const remoteData = await readRemoteData(path);
          const localBytes = new Uint8Array(localData);
          const remoteBytes = new Uint8Array(remoteData);
          if (localBytes.length !== remoteBytes.length || !localBytes.every((byte, index) => byte === remoteBytes[index])) continue;
          const text = new TextDecoder("utf-8", { fatal: true }).decode(localData);
          await writeRemoteData(`${prefix}${crypto.randomUUID()}.yjs`, createCrdtSeed(text), Date.now());
        }
      }
      const conflictSummary = result.conflicts.length
        ? `; conflicts left untouched: ${result.conflicts.join(", ")}`
        : "";
      new Notice(
        `Cloud sync complete: ${result.uploaded} uploaded, ${result.downloaded} downloaded${conflictSummary}`
      );
      this.addLog(`Sync complete: ${result.uploaded} uploaded, ${result.downloaded} downloaded, ${result.conflicts.length} unresolved conflicts.`);
      completed = true;
    } catch (error) {
      console.error("OCloudSync failed", error);
      const message = error instanceof Error ? error.message : String(error);
      if (message === "SYNC_CANCELLED") {
        this.addLog("Sync stopped by user after current operations finished.", "WARN");
        this.settings.syncRecoveryPending = false;
        new Notice("Sync paused. Run Sync now to continue.");
      }
      else if (message === "SYNC_PROTECTED") {
        this.addLog("Sync stopped by the safety check because it could modify or remove many files.", "WARN");
        this.settings.syncRecoveryPending = false;
        new Notice("Sync stopped because it would change many files. Start it manually and confirm to continue.");
      }
      else {
        this.addLog(`Sync failed: ${message}`, "ERROR");
        new Notice(`Cloud sync failed: ${message}`);
      }
    } finally {
      this.isSyncing = false;
      this.updateSyncToggleButton();
      try {
        if (completed) this.settings.syncRecoveryPending = false;
        await this.saveSettings();
      } catch (error) {
        console.error("Could not save OCloudSync settings", error);
      }
      if (this.syncPending && (this.settings.autoSync || this.settings.syncOnSave)) {
        this.syncPending = false;
        this.scheduleSync();
      } else {
        this.syncPending = false;
      }
    }
  }

  cancelSync(): void {
    if (!this.isSyncing) {
      new Notice("No cloud sync is running.");
      return;
    }
    this.cancelSyncRequested = true;
    this.syncPending = false;
    if (this.syncDebounceId !== null) {
      window.clearTimeout(this.syncDebounceId);
      this.syncDebounceId = null;
    }
    new Notice("Stopping after the current file operations finish…");
  }

  get syncRunning(): boolean { return this.isSyncing; }

  private openPluginSettings(): void {
    const settingManager = (this.app as typeof this.app & {
      setting?: { open: () => void; openTabById: (id: string) => void };
    }).setting;
    if (!settingManager) {
      new Notice("Could not open plugin settings.");
      return;
    }
    settingManager.open();
    settingManager.openTabById(this.manifest.id);
  }

  bindSyncToggleButton(button: { setButtonText: (text: string) => unknown; setCta: () => unknown; removeCta: () => unknown }): void {
    this.syncToggleButton = button;
    this.updateSyncToggleButton();
  }

  private updateSyncToggleButton(): void {
    if (!this.syncToggleButton) return;
    this.syncToggleButton.setButtonText(this.isSyncing ? "Cancel sync" : "Start sync");
    if (this.isSyncing) this.syncToggleButton.removeCta();
    else this.syncToggleButton.setCta();
  }

  async encryptRemoteStorage(oldPassword: string, newPassword: string): Promise<void> {
    const targetMethod = this.settings.encryptionMethodTarget;
    if (!oldPassword && !newPassword) {
      this.settings.encryptionMethod = targetMethod;
      this.settings.baseline = {};
      await this.saveSettings();
      return;
    }
    const provider = createProvider(this.settings);
    const files = await provider.list();
    for (const file of files) {
      let oldLogicalPath: string;
      try { oldLogicalPath = await decryptPath(file.path, newPassword); }
      catch { oldLogicalPath = await decryptPath(file.path, oldPassword); }
      const data = await provider.read(file.path);
      let plain = data;
      try { plain = await decryptFile(data, newPassword || oldPassword); }
      catch { plain = await decryptFile(data, oldPassword); }
      const newRemotePath = newPassword ? await encryptPath(oldLogicalPath, newPassword, targetMethod) : oldLogicalPath;
      const output = newPassword ? await encryptFileWithMethod(plain, newPassword, targetMethod) : plain;
      await provider.write(newRemotePath, output, file.mtime);
      if (newRemotePath !== file.path) await provider.delete(file.path);
    }
    this.settings.encryptionPassword = newPassword;
    this.settings.encryptionMethod = targetMethod;
    this.settings.baseline = {};
    await this.saveSettings();
  }
}

class ConfirmModal extends Modal {
  private settled = false;
  constructor(
    app: import("obsidian").App,
    private readonly message: string,
    private readonly confirm: () => void | Promise<void>,
    private readonly cancel: () => void = () => {}
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl("p", { text: this.message });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => {
      this.settled = true;
      this.close();
      this.cancel();
    });
    const ok = buttons.createEl("button", { text: "OK", cls: "mod-cta" });
    ok.addEventListener("click", () => {
      this.settled = true;
      this.close();
      void this.confirm();
    });
  }

  onClose(): void {
    if (!this.settled) this.cancel();
    this.contentEl.empty();
  }
}

class MyCloudSyncSettingTab extends PluginSettingTab {
  private readonly plugin: MyCloudSyncPlugin;
  private currentPage: "main" | "pro" | "log" | "export" = "main";

  constructor(app: Plugin["app"], plugin: MyCloudSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.addClass("ocs-settings");
    this.plugin.setLogView();
    containerEl.empty();
    new Setting(containerEl).setName(this.plugin.manifest.name).setHeading();
    const pageNav = new Setting(containerEl);
    pageNav.settingEl.addClass("ocs-page-nav");
    pageNav.infoEl.hide();
    pageNav
      .addButton((button) => {
        button.setButtonText("Main");
        if (this.currentPage === "main") button.setCta();
        else button.removeCta();
        return button
        .onClick(() => {
          this.currentPage = "main";
          this.display();
        });
      })
      .addButton((button) => {
        button.setButtonText("Pro settings");
        if (this.currentPage === "pro") button.setCta();
        else button.removeCta();
        return button.onClick(() => {
          this.currentPage = "pro";
          this.display();
        });
      })
      .addButton((button) => {
        button.setButtonText("Log");
        if (this.currentPage === "log") button.setCta();
        else button.removeCta();
        return button.onClick(() => {
          this.currentPage = "log";
          this.display();
        });
      })
      .addButton((button) => {
        button.setButtonText("Export");
        if (this.currentPage === "export") button.setCta();
        else button.removeCta();
        return button.onClick(() => {
          this.currentPage = "export";
          this.display();
        });
      });

    if (this.currentPage === "log") {
      this.displayLog(containerEl);
      return;
    }

    if (this.currentPage === "pro") {
      this.displayProSettings(containerEl);
      return;
    }

    if (this.currentPage === "export") {
      this.displayExport(containerEl);
      return;
    }

    new Setting(containerEl).setName("General").setHeading();

    new Setting(containerEl)
      .setName("Cloud provider")
      .setDesc("Choose a connected cloud service for this vault.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("webdav", "WebDAV (Nextcloud, ownCloud, etc.)")
          .addOption("google-drive", "Google Drive")
          .addOption("s3", "S3-compatible storage (AWS, Cloudflare R2, MinIO, etc.)")
          .addOption("azure-blob", "Azure Blob Storage")
          .addOption("dropbox", "Dropbox")
          .addOption("onedrive", "OneDrive Personal (app folder)")
          .addOption("yandex-disk", "Yandex Disk")
          .addOption("pcloud", "pCloud")
          .addOption("webdis", "Webdis (Redis HTTP gateway)")
          .addOption("box", "Box")
          .setValue(this.plugin.settings.provider)
          .onChange(async (value) => {
            if (value !== "webdav" && value !== "google-drive" && value !== "s3" && value !== "azure-blob" && value !== "dropbox" && value !== "onedrive" && value !== "yandex-disk" && value !== "pcloud" && value !== "webdis" && value !== "box") {
              throw new Error(`Unsupported cloud provider: ${value}`);
            }
            this.plugin.settings.provider = value;
            this.plugin.settings.baseline = {};
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName("Remote folder")
      .setDesc("Folder path on the cloud. It is created automatically if needed.")
      .addText((text) =>
        text
          .setPlaceholder("Obsidian")
          .setValue(this.plugin.settings.remoteFolder)
          .onChange(async (value) => {
            const nextFolder = value.trim();
            if (nextFolder !== this.plugin.settings.remoteFolder) {
              this.plugin.settings.baseline = {};
            }
            this.plugin.settings.remoteFolder = nextFolder;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Automatic sync")
      .setDesc("Debounce vault changes and sync automatically.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSync)
          .onChange((enabled) => this.plugin.setAutoSync(enabled))
      );

    new Setting(containerEl)
      .setName("Sync on file save")
      .setDesc("Start a debounced sync after a vault file is modified.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.syncOnSave)
        .onChange(async (enabled) => {
          this.plugin.settings.syncOnSave = enabled;
          await this.plugin.saveSettings();
        }));

    const scheduledSyncGroup = containerEl.createDiv();
    scheduledSyncGroup.addClass("ocs-settings-group");

    new Setting(scheduledSyncGroup)
      .setName("Scheduled sync")
      .setDesc("Run a sync at a regular interval while Obsidian is open.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.scheduledSync)
        .onChange(async (enabled) => {
          this.plugin.settings.scheduledSync = enabled;
          this.plugin.refreshScheduledSync();
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.settings.scheduledSync) {
      new Setting(scheduledSyncGroup)
        .setName("Sync interval (minutes)")
        .setDesc("Choose how often scheduled sync runs.")
        .addDropdown((dropdown) => dropdown
          .addOption("2", "2 min")
          .addOption("5", "5 min")
          .addOption("10", "10 min")
          .addOption("20", "20 min")
          .addOption("30", "30 min")
          .setValue(String(this.plugin.settings.scheduledSyncMinutes))
          .onChange(async (value) => {
            this.plugin.settings.scheduledSyncMinutes = this.plugin.validInterval(Number(value));
            this.plugin.refreshScheduledSync();
            await this.plugin.saveSettings();
          }));
    }

    new Setting(containerEl)
      .setName("Excluded path patterns")
      .setDesc("One JavaScript regular expression per line. Matching vault paths are skipped.")
      .addTextArea((text) => text
        .setPlaceholder("^Private/\\n\\.secret")
        .setValue(this.plugin.settings.ignorePatterns)
        .onChange(async (value) => {
          this.plugin.settings.ignorePatterns = value;
          await this.plugin.saveSettings();
        }));

    const pathSyncGroup = containerEl.createDiv();
    pathSyncGroup.addClass("ocs-settings-group");

    for (const [key, title, description] of [
      ["includeUnderscorePaths", "Sync underscore paths", "Include files and folders whose names start with underscore."],
      ["syncConfigFolder", "Sync Obsidian configuration folder", `Experimental: sync all of ${this.app.vault.configDir}. Changes may vary between devices.`],
      ["syncBookmarks", "Sync bookmarks", `Sync ${this.app.vault.configDir}/bookmarks.json without syncing the rest of the configuration folder.`],
    ] as const) {
      new Setting(pathSyncGroup)
        .setName(title)
        .setDesc(description)
        .addToggle((toggle) => toggle
          .setValue(this.plugin.settings[key])
          .onChange(async (value) => {
            this.plugin.settings[key] = value;
            await this.plugin.saveSettings();
          }));
    }

    new Setting(containerEl)
      .setName("Conflict choice")
      .setDesc("Choose how conflicting changes are handled. CRDT merges concurrent Markdown edits; other files use the selected file-level policy.")
      .addDropdown((dropdown) => dropdown
        .addOption("keep-newer", "Keep newer")
        .addOption("keep-larger", "Keep larger")
        .addOption("keep-both", "Keep both copies")
        .addOption("merge-markdown", "Merge Markdown; keep both if edits overlap")
        .addOption("crdt", "CRDT merge (Markdown)")
        .addOption("prefer-local", "Prefer this device (local changes win)")
        .setValue(this.plugin.settings.conflictAction)
        .onChange(async (value) => {
          if (value === "keep-newer" || value === "keep-larger" || value === "keep-both" || value === "merge-markdown" || value === "crdt" || value === "prefer-local") {
            this.plugin.settings.conflictAction = value;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName("End-to-end encryption password")
      .setDesc("Vault file contents and remote file/folder names are encrypted before upload with the method selected in Pro settings. Use the same password and method on every device.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("Leave empty to disable encryption");
        text.setValue(this.plugin.settings.encryptionPassword);
        this.passwordInput = text.inputEl;
      })
      .addExtraButton((button) => button
        .setIcon("eye")
        .setTooltip("Show password")
        .onClick(() => {
          const input = this.passwordInput;
          if (!input) return;
          const showPassword = input.type === "password";
          input.type = showPassword ? "text" : "password";
          button.setIcon(showPassword ? "eye-off" : "eye");
          button.setTooltip(showPassword ? "Hide password" : "Show password");
        }))
      .addButton((button) => button
        .setButtonText("Encrypt / convert")
        .onClick(() => {
          const nextPassword = this.passwordInput?.value ?? "";
          const oldPassword = this.plugin.settings.encryptionPassword;
          if (nextPassword === oldPassword && this.plugin.settings.encryptionMethod === this.plugin.settings.encryptionMethodTarget) {
            new Notice("That encryption password is already active.");
            return;
          }
          new ConfirmModal(this.app, "This will rewrite every remote file and encrypt or decrypt its contents and path names using the selected method. Continue?", async () => {
            if (this.plugin.syncRunning) this.plugin.cancelSync();
            while (this.plugin.syncRunning) await new Promise((resolve) => window.setTimeout(resolve, 100));
            try {
              new Notice("Encrypting remote storage…");
              await this.plugin.encryptRemoteStorage(oldPassword, nextPassword);
              new Notice("Remote storage encryption complete.");
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              new Notice(`Storage encryption stopped: ${message}. Apply the same password again to continue.`);
            }
          }).open();
        }));

    if (this.plugin.settings.provider === "webdav") {
      this.displayWebDavSettings(containerEl);
    } else if (this.plugin.settings.provider === "google-drive") {
      this.displayGoogleSettings(containerEl);
    } else if (this.plugin.settings.provider === "s3") {
      this.displayS3Settings(containerEl);
    } else if (this.plugin.settings.provider === "azure-blob") {
      this.displayAzureSettings(containerEl);
    } else if (this.plugin.settings.provider === "dropbox") {
      this.displayDropboxSettings(containerEl);
    } else if (this.plugin.settings.provider === "onedrive") {
      this.displayOneDriveSettings(containerEl);
    } else if (this.plugin.settings.provider === "yandex-disk") {
      this.displayYandexDiskSettings(containerEl);
    } else if (this.plugin.settings.provider === "pcloud") {
      this.displayPCloudSettings(containerEl);
    } else if (this.plugin.settings.provider === "webdis") {
      this.displayWebdisSettings(containerEl);
    } else {
      this.displayBoxSettings(containerEl);
    }

    new Setting(containerEl)
      .setName("Sync now")
      .setDesc("Only changed files are transferred. Markdown files use CRDT updates to merge concurrent edits; cloud providers still store each changed Markdown file as a whole object.")
      .addButton((button) => {
        this.plugin.bindSyncToggleButton(button);
        button.onClick(() => {
          if (this.plugin.syncRunning) {
            this.plugin.cancelSync();
            button.setButtonText("Stopping…");
            button.removeCta();
          } else {
            void this.plugin.syncNow(true);
          }
        });
      });
  }

  private passwordInput?: HTMLInputElement;

  private displayLog(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Extension log").setHeading();
    containerEl.createEl("p", { text: "Recent sync activity and errors. The log is stored in this vault's plugin settings and keeps the latest 500 lines." });
    const textarea = containerEl.createEl("textarea", { cls: "ocs-log-textarea", attr: { rows: Platform.isMobile ? "14" : "22", readonly: "true", spellcheck: "false" } });
    textarea.addClass("ocs-log-textarea");
    textarea.value = this.plugin.settings.logText;
    textarea.scrollTop = textarea.scrollHeight;
    this.plugin.setLogView(textarea);

    const actions = new Setting(containerEl);
    actions.infoEl.hide();
    actions
      .addButton((button) => button.setButtonText("Copy log").onClick(async () => {
        try {
          await navigator.clipboard.writeText(this.plugin.settings.logText);
          new Notice("Log copied.");
        } catch {
          textarea.focus();
          textarea.select();
          new Notice("Select and copy the log manually.");
        }
      }))
      .addButton((button) => button.setButtonText("Clear log").onClick(async () => {
        this.plugin.settings.logText = "";
        textarea.value = "";
        await this.plugin.saveSettings();
        new Notice("Log cleared.");
      }));
  }

  private displayExport(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Export and import").setHeading();
    containerEl.createEl("p", { text: "Download all OCloudSync settings as one JSON file. On mobile, the system share sheet lets you save the file to Files or another location." });
    const warning = containerEl.createEl("div", { cls: "ocs-export-warning" });
    warning.createEl("strong", { text: "Sensitive file" });
    warning.createEl("p", { text: "The export includes cloud passwords, OAuth tokens, access keys, and the encryption password. Anyone with this file can access those accounts and data. Store it securely and delete it when you no longer need it." });
    const fileInput = containerEl.createEl("input", { cls: "ocs-hidden-file-input", attr: { type: "file", accept: ".json,application/json" } });
    let importButton: { setDisabled: (disabled: boolean) => unknown };
    const importSetting = new Setting(containerEl)
      .setName("Settings import")
      .setDesc("Choose an OCloudSync JSON export. Sync history will be reset so the next sync can compare files afresh.")
      .addButton((button) => {
        importButton = button.setButtonText("Import settings file").onClick(() => fileInput.click());
        return importButton;
      });
    fileInput.addEventListener("change", () => {
      void (async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        importButton.setDisabled(true);
        try {
          await this.plugin.importSettingsFile(file);
          new Notice("Settings imported. Review the provider, then choose Sync now when ready.");
          this.display();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.plugin.addLog(`Settings import failed: ${message}`, "ERROR");
          new Notice(`Settings import failed: ${message}`);
        } finally {
          fileInput.value = "";
          if (importSetting.settingEl.isConnected) importButton.setDisabled(false);
        }
      })();
    });
    new Setting(containerEl)
      .setName("Settings export")
      .setDesc("Creates one portable JSON file. Sync history and the log are left out.")
      .addButton((button) => button
        .setButtonText("Export settings file")
        .setCta()
        .onClick(async () => {
          button.setDisabled(true);
          try {
            await this.plugin.exportSettingsFile();
            new Notice("Settings export created.");
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.plugin.addLog(`Settings export failed: ${message}`, "ERROR");
            new Notice(`Settings export failed: ${message}`);
          } finally {
            button.setDisabled(false);
          }
        }));
  }

  private displayProSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Advanced").setHeading();
    new Setting(containerEl).setName("Encryption format").setHeading();
    new Setting(containerEl)
      .setName("Encryption method")
      .setDesc(`Active: ${this.plugin.settings.encryptionMethod === "openssl-aes-cbc" ? "OpenSSL AES-256-CBC" : "AES-256-GCM"}. AES-GCM is recommended. OpenSSL AES-CBC is provided for openssl enc compatibility, but does not authenticate data. Choose a format, then apply it to convert remote files.`)
      .addDropdown((dropdown) => dropdown
        .addOption("aes-gcm", "AES-256-GCM (recommended)")
        .addOption("openssl-aes-cbc", "OpenSSL AES-256-CBC")
        .setValue(this.plugin.settings.encryptionMethodTarget)
        .onChange(async (value) => {
          this.plugin.settings.encryptionMethodTarget = value === "openssl-aes-cbc" ? "openssl-aes-cbc" : "aes-gcm";
          await this.plugin.saveSettings();
        }))
      .addButton((button) => button
        .setButtonText("Apply")
        .onClick(() => {
          const methodLabel = this.plugin.settings.encryptionMethodTarget === "openssl-aes-cbc" ? "OpenSSL AES-256-CBC" : "AES-256-GCM";
          new ConfirmModal(this.app, `Convert the remote storage to ${methodLabel}? This rewrites remote files using the current encryption password. Keep a backup before changing formats.`, async () => {
            if (this.plugin.syncRunning) this.plugin.cancelSync();
            while (this.plugin.syncRunning) await new Promise((resolve) => window.setTimeout(resolve, 100));
            try {
              await this.plugin.encryptRemoteStorage(this.plugin.settings.encryptionPassword, this.plugin.settings.encryptionPassword);
              this.plugin.addLog(`Remote encryption format converted to ${methodLabel}.`);
              new Notice(`Remote storage converted to ${methodLabel}.`);
              this.display();
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              this.plugin.addLog(`Encryption conversion failed: ${message}`, "ERROR");
              new Notice(`Encryption conversion failed: ${message}. Reapply the same method to continue.`);
            }
          }).open();
        }));
    new Setting(containerEl)
      .setName("Parallel file transfers")
      .setDesc(`Maximum number of files uploaded, downloaded, or reconciled at once. Lower this value if your cloud service limits requests. Default: 5.${Platform.isMobile ? " Mobile sync is capped at 3 simultaneous files to reduce memory and connection pressure." : ""}`)
      .addDropdown((dropdown) => {
        for (const count of [1, 2, 3, 5, 8, 10, 15, 20]) dropdown.addOption(String(count), count === 5 ? "5 (default)" : String(count));
        dropdown
          .setValue(String(this.plugin.settings.syncConcurrency))
          .onChange(async (value) => {
            this.plugin.settings.syncConcurrency = this.plugin.validConcurrency(Number(value));
            await this.plugin.saveSettings();
          });
      });
    new Setting(containerEl)
      .setName("Sidebar icon action")
      .setDesc("Choose whether the My Cloud Sync sidebar icon starts synchronization or opens this plugin's settings.")
      .addDropdown((dropdown) => dropdown
        .addOption("sync", "Start sync")
        .addOption("settings", "Open plugin settings")
        .setValue(this.plugin.settings.ribbonAction)
        .onChange(async (value) => {
          this.plugin.settings.ribbonAction = value === "settings" ? "settings" : "sync";
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Maximum file size (MB)")
      .setDesc("Files larger than this are skipped. Set to 0 for no limit.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text.setValue(String(this.plugin.settings.maxFileSizeMb));
        text.onChange(async (value) => {
          const parsed = Number(value);
          if (Number.isFinite(parsed) && parsed >= 0) {
            this.plugin.settings.maxFileSizeMb = this.plugin.validMaxSize(parsed);
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("Synchronize deletions")
      .setDesc("A deletion on either side is applied to the other side after a path has been synchronized at least once.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.syncDeletions)
        .onChange(async (enabled) => {
          this.plugin.settings.syncDeletions = enabled;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Move deleted vault files to")
      .setDesc("When a cloud-side deletion is synchronized to this vault, move the local file to the selected trash location.")
      .addDropdown((dropdown) => dropdown
        .addOption("obsidian", "Obsidian trash")
        .addOption("system", "System trash (fallback to Obsidian trash)")
        .setValue(this.plugin.settings.syncDeleteLocation)
        .onChange(async (value) => {
          this.plugin.settings.syncDeleteLocation = value === "system" ? "system" : "obsidian";
          await this.plugin.saveSettings();
        }));
  }

  private displayWebDavSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("WebDAV connection").setHeading();
    new Setting(containerEl)
      .setName("WebDAV server URL")
      .setDesc("Use HTTPS, for example https://cloud.example.com/remote.php/dav/files/user/")
      .addText((text) =>
        text
          .setPlaceholder("https://cloud.example.com/remote.php/dav/files/user/")
          .setValue(this.plugin.settings.webdavUrl)
          .onChange(async (value) => {
            const nextUrl = value.trim();
            if (nextUrl !== this.plugin.settings.webdavUrl) {
              this.plugin.settings.baseline = {};
            }
            this.plugin.settings.webdavUrl = nextUrl;
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName("Username")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.webdavUsername)
          .onChange(async (value) => {
            if (value !== this.plugin.settings.webdavUsername) {
              this.plugin.settings.baseline = {};
            }
            this.plugin.settings.webdavUsername = value;
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName("Password")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setValue(this.plugin.settings.webdavPassword)
          .onChange(async (value) => {
            if (value !== this.plugin.settings.webdavPassword) {
              this.plugin.settings.baseline = {};
            }
            this.plugin.settings.webdavPassword = value;
            await this.plugin.saveSettings();
          });
      });
  }

  private displayS3Settings(containerEl: HTMLElement): void {
    containerEl.createEl("p", { text: "Use an AWS S3 bucket or an S3-compatible service. Leave endpoint blank for AWS; custom services usually require an endpoint URL and path-style addressing." });
    const fields: Array<[keyof PluginSettings, string, string, boolean?]> = [
      ["s3Bucket", "Bucket", "my-obsidian-vault"],
      ["s3Region", "Region", "us-east-1"],
      ["s3Endpoint", "Endpoint URL (optional)", "https://s3.example.com"],
      ["s3AccessKey", "Access key ID", "Access key ID"],
      ["s3SecretKey", "Secret access key", "Secret access key", true],
    ];
    for (const [key, name, placeholder, password] of fields) {
      new Setting(containerEl)
        .setName(name)
        .addText((text) => {
          if (password) text.inputEl.type = "password";
          text.setPlaceholder(placeholder).setValue(String(this.plugin.settings[key]));
          text.onChange(async (value) => {
            (this.plugin.settings[key] as string) = value.trim();
            await this.plugin.saveSettings();
          });
        });
    }
  }

  private displayAzureSettings(containerEl: HTMLElement): void {
    containerEl.createEl("p", { text: "Create a container SAS URL with read, write, list, and delete permissions. The SAS URL is stored in this vault's plugin settings." });
    new Setting(containerEl)
      .setName("Container SAS URL")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("https://account.blob.core.windows.net/container?sv=...")
          .setValue(this.plugin.settings.azureSasUrl);
        text.onChange(async (value) => {
          this.plugin.settings.azureSasUrl = value.trim();
          await this.plugin.saveSettings();
        });
      });
  }

  private displayDropboxSettings(containerEl: HTMLElement): void {
    containerEl.createEl("p", { text: this.plugin.settings.dropboxAppKey
      ? (this.plugin.settings.dropboxRefreshToken ? "Dropbox is connected. Reconnect any time with one click." : "Connect your Dropbox account with one click.")
      : "First, create a Dropbox app and paste its app key below. You only need to do this once.",
    });
    if (!this.plugin.settings.dropboxAppKey) {
      new Setting(containerEl)
        .setName("One-time setup")
        .setDesc(`In Dropbox, create a Scoped access app with Full Dropbox access. Enable account_info.read, files.metadata.read, files.content.read, and files.content.write.${Platform.isMobile ? "" : " Add redirect URI http://localhost:53683/dropbox-callback."}`)
        .addButton((button) => button
          .setButtonText("Create Dropbox app")
          .setCta()
          .onClick(() => window.open("https://www.dropbox.com/developers/apps/create")));
    }
    new Setting(containerEl)
      .setName("Dropbox app key")
      .addText((text) => text
        .setPlaceholder("Dropbox app key")
        .setValue(this.plugin.settings.dropboxAppKey)
        .onChange(async (value) => {
          this.plugin.settings.dropboxAppKey = value.trim();
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("Dropbox account")
      .setDesc(this.plugin.settings.dropboxRefreshToken ? "Dropbox is connected." : Platform.isMobile ? "Sign in in the browser, then paste the one-time Dropbox code back into Obsidian." : "Connect your Dropbox account to authorize file access.")
      .addButton((button) => button
        .setButtonText(this.plugin.settings.dropboxRefreshToken ? "Reconnect Dropbox" : "Connect Dropbox")
        .onClick(async () => {
          button.setDisabled(true);
          try {
            await connectDropbox(this.plugin.settings, this.app);
            this.plugin.settings.baseline = {};
            await this.plugin.saveSettings();
            this.plugin.addLog("Dropbox account connected.");
            new Notice("Dropbox connected.");
            this.display();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.plugin.addLog(`Dropbox connection failed: ${message}`, "ERROR");
            new Notice(`Dropbox connection failed: ${message}`);
          } finally { button.setDisabled(false); }
        }))
      .addButton((button) => button
        .setButtonText("Disconnect")
        .onClick(async () => {
          this.plugin.settings.dropboxRefreshToken = "";
          this.plugin.settings.dropboxAccessToken = "";
          this.plugin.settings.dropboxAccessTokenExpiresAt = 0;
          this.plugin.settings.baseline = {};
          await this.plugin.saveSettings();
          this.display();
        }));
  }

  private displayOneDriveSettings(containerEl: HTMLElement): void {
    containerEl.createEl("p", { text: `OneDrive Personal is accessed through Microsoft Graph. App-folder access is narrower; full-drive access requires Files.ReadWrite. ${Platform.isMobile ? "Enable public client and device code flow in your Microsoft app registration." : "Register http://localhost as a desktop redirect URI."}` });
    new Setting(containerEl)
      .setName("Microsoft application client ID")
      .addText((text) => text
        .setPlaceholder("Application (client) ID")
        .setValue(this.plugin.settings.oneDriveClientId)
        .onChange(async (value) => {
          this.plugin.settings.oneDriveClientId = value.trim();
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("Use full OneDrive access")
      .setDesc("Sync the drive root instead of the plugin app folder. Reconnect after changing this option.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.oneDriveFullAccess)
        .onChange(async (enabled) => {
          this.plugin.settings.oneDriveFullAccess = enabled;
          this.plugin.settings.oneDriveRefreshToken = "";
          this.plugin.settings.oneDriveAccessToken = "";
          this.plugin.settings.oneDriveAccessTokenExpiresAt = 0;
          this.plugin.settings.baseline = {};
          await this.plugin.saveSettings();
          this.display();
        }));
    new Setting(containerEl)
      .setName("OneDrive account")
      .setDesc(this.plugin.settings.oneDriveRefreshToken ? "OneDrive is connected." : Platform.isMobile ? "Microsoft displays a one-time code; approve it in your browser while Obsidian waits." : "Connect a personal OneDrive account.")
      .addButton((button) => button
        .setButtonText(this.plugin.settings.oneDriveRefreshToken ? "Reconnect OneDrive" : "Connect OneDrive")
        .onClick(async () => {
          button.setDisabled(true);
          try {
            await connectOneDrive(this.plugin.settings, this.app);
            this.plugin.settings.baseline = {};
            await this.plugin.saveSettings();
            this.plugin.addLog("OneDrive account connected.");
            new Notice("OneDrive connected.");
            this.display();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.plugin.addLog(`OneDrive connection failed: ${message}`, "ERROR");
            new Notice(`OneDrive connection failed: ${message}`);
          } finally { button.setDisabled(false); }
        }))
      .addButton((button) => button
        .setButtonText("Disconnect")
        .onClick(async () => {
          this.plugin.settings.oneDriveRefreshToken = "";
          this.plugin.settings.oneDriveAccessToken = "";
          this.plugin.settings.oneDriveAccessTokenExpiresAt = 0;
          this.plugin.settings.baseline = {};
          await this.plugin.saveSettings();
          this.display();
        }));
  }

  private displayYandexDiskSettings(containerEl: HTMLElement): void {
    containerEl.createEl("p", { text: "Create a Yandex OAuth application with Yandex Disk access. Register https://oauth.yandex.ru/verification_code as its redirect URI, then authorize below and paste the resulting token." });
    new Setting(containerEl)
      .setName("Yandex OAuth application ID")
      .addText((text) => text
        .setPlaceholder("Application ID")
        .setValue(this.plugin.settings.yandexDiskClientId)
        .onChange(async (value) => {
          this.plugin.settings.yandexDiskClientId = value.trim();
          await this.plugin.saveSettings();
        }));
    containerEl.createEl("a", { text: "Open Yandex authorization", href: "#" }).addEventListener("click", (event) => {
      event.preventDefault();
      if (!this.plugin.settings.yandexDiskClientId) { new Notice("Enter the Yandex OAuth application ID first."); return; }
      const authUrl = `https://oauth.yandex.com/authorize?${new URLSearchParams({ response_type: "token", client_id: this.plugin.settings.yandexDiskClientId }).toString()}`;
      window.open(authUrl);
    });
    new Setting(containerEl)
      .setName("Yandex Disk OAuth token")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("OAuth token").setValue(this.plugin.settings.yandexDiskToken);
        text.onChange(async (value) => {
          this.plugin.settings.yandexDiskToken = value.trim();
          await this.plugin.saveSettings();
        });
      });
  }

  private displayPCloudSettings(containerEl: HTMLElement): void {
    containerEl.createEl("p", { text: "Create a pCloud API app, grant file access, and paste its OAuth token. Select the region where your pCloud account is registered." });
    new Setting(containerEl)
      .setName("pCloud OAuth token")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("OAuth token").setValue(this.plugin.settings.pcloudToken);
        text.onChange(async (value) => {
          this.plugin.settings.pcloudToken = value.trim();
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName("pCloud region")
      .addDropdown((dropdown) => dropdown
        .addOption("us", "United States")
        .addOption("eu", "Europe")
        .setValue(this.plugin.settings.pcloudRegion)
        .onChange(async (value) => {
          if (value === "us" || value === "eu") {
            this.plugin.settings.pcloudRegion = value;
            this.plugin.settings.baseline = {};
            await this.plugin.saveSettings();
          }
        }));
  }

  private displayWebdisSettings(containerEl: HTMLElement): void {
    containerEl.createEl("p", { text: "Webdis stores file bytes in Redis keys. Use a private server with HTTPS and authenticated access. The configured Redis account needs SCAN, GET, SET, and DEL permissions." });
    for (const [key, name, placeholder, password] of [
      ["webdisUrl", "Webdis server URL", "https://redis-gateway.example.com/", false],
      ["webdisUsername", "Username (optional)", "Username", false],
      ["webdisPassword", "Password (optional)", "Password", true],
    ] as const) {
      new Setting(containerEl).setName(name).addText((text) => {
        if (password) text.inputEl.type = "password";
        text.setPlaceholder(placeholder).setValue(this.plugin.settings[key]);
        text.onChange(async (value) => {
          this.plugin.settings[key] = value.trim();
          await this.plugin.saveSettings();
        });
      });
    }
  }

  private displayBoxSettings(containerEl: HTMLElement): void {
    containerEl.createEl("p", { text: "Create a Box OAuth 2.0 application with read/write access. Register the exact localhost redirect URI below in Box Developer Console. Box OAuth setup is available on desktop; connected tokens can be transferred to mobile." });
    for (const [key, name, placeholder, password] of [
      ["boxClientId", "Box client ID", "Client ID", false],
      ["boxClientSecret", "Box client secret", "Client secret", true],
      ["boxRedirectUri", "Redirect URI", "http://localhost:53682/callback", false],
    ] as const) {
      new Setting(containerEl).setName(name).addText((text) => {
        if (password) text.inputEl.type = "password";
        text.setPlaceholder(placeholder).setValue(this.plugin.settings[key]);
        text.onChange(async (value) => {
          this.plugin.settings[key] = value.trim();
          await this.plugin.saveSettings();
        });
      });
    }
    new Setting(containerEl)
      .setName("Box account")
      .setDesc(this.plugin.settings.boxRefreshToken ? "Box is connected." : "Connect your Box account.")
      .addButton((button) => button
        .setButtonText(Platform.isMobile ? "Connect on desktop" : this.plugin.settings.boxRefreshToken ? "Reconnect Box" : "Connect Box")
        .setDisabled(Platform.isMobile)
        .onClick(async () => {
          button.setDisabled(true);
          try {
            await connectBox(this.plugin.settings);
            this.plugin.settings.baseline = {};
            await this.plugin.saveSettings();
            this.plugin.addLog("Box account connected.");
            new Notice("Box connected.");
            this.display();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.plugin.addLog(`Box connection failed: ${message}`, "ERROR");
            new Notice(`Box connection failed: ${message}`);
          } finally { button.setDisabled(false); }
        }))
      .addButton((button) => button.setButtonText("Disconnect").onClick(async () => {
        this.plugin.settings.boxRefreshToken = "";
        this.plugin.settings.boxAccessToken = "";
        this.plugin.settings.boxAccessTokenExpiresAt = 0;
        this.plugin.settings.baseline = {};
        await this.plugin.saveSettings();
        this.display();
      }));
  }

  private displayGoogleSettings(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      text: "Create a Google OAuth client and enable the Google Drive API. Enter its client ID. If Google reports that client_secret is missing, also enter the secret from the same client in Google Cloud Console. Connect opens Google's sign-in page and returns here automatically.",
    });
    new Setting(containerEl)
      .setName("Google OAuth client ID")
      .addText((text) =>
        text
          .setPlaceholder("...apps.googleusercontent.com")
          .setValue(this.plugin.settings.googleClientId)
          .onChange(async (value) => {
            this.plugin.settings.googleClientId = value.trim();
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName("Google OAuth client secret (if required)")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("Client secret")
          .setValue(this.plugin.settings.googleClientSecret)
          .onChange(async (value) => {
            this.plugin.settings.googleClientSecret = value.trim();
            await this.plugin.saveSettings();
          });
      });
    new Setting(containerEl)
      .setName("Google account")
      .setDesc(
        this.plugin.settings.googleRefreshToken
          ? "Google Drive is connected."
          : Platform.isMobile ? "Connect Google Drive on desktop, then securely transfer the plugin settings to this device." : "Connect an account to authorize this plugin to manage its own Drive files."
      )
      .addButton((button) =>
        button
          .setButtonText(
            Platform.isMobile ? "Connect on desktop" : this.plugin.settings.googleRefreshToken
              ? "Reconnect Google Drive"
              : "Connect Google Drive"
          )
          .setDisabled(Platform.isMobile)
          .onClick(async () => {
            button.setDisabled(true);
            try {
              await connectGoogleDrive(this.plugin.settings);
              this.plugin.settings.baseline = {};
              await this.plugin.saveSettings();
              this.plugin.addLog("Google Drive account connected.");
              new Notice("Google Drive connected.");
              this.display();
            } catch (error) {
              console.error("Google Drive connection failed", error);
              const message = error instanceof Error ? error.message : String(error);
              this.plugin.addLog(`Google Drive connection failed: ${message}`, "ERROR");
              new Notice(`Google Drive connection failed: ${message}`);
            } finally {
              button.setDisabled(false);
            }
          })
      )
      .addButton((button) =>
        button.setButtonText("Disconnect").onClick(async () => {
          this.plugin.settings.googleRefreshToken = "";
          this.plugin.settings.googleAccessToken = "";
          this.plugin.settings.googleAccessTokenExpiresAt = 0;
          this.plugin.settings.baseline = {};
          await this.plugin.saveSettings();
          this.display();
        })
      );
  }
}
