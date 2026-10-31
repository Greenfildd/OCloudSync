export type ProviderKind = "webdav" | "google-drive" | "s3" | "azure-blob" | "dropbox" | "onedrive" | "yandex-disk" | "pcloud" | "webdis" | "box";
export type RibbonAction = "sync" | "settings";
export type EncryptionMethod = "aes-gcm" | "openssl-aes-cbc";

export interface FileEntry {
  path: string;
  mtime: number;
  size: number;
  isFolder: false;
}

export interface CloudProvider {
  list(): Promise<FileEntry[]>;
  read(path: string): Promise<ArrayBuffer>;
  write(path: string, data: ArrayBuffer, mtime: number): Promise<void>;
  delete(path: string): Promise<void>;
}

export interface FileSignature {
  mtime: number;
  size: number;
}

export interface SyncBaseline {
  local: FileSignature;
  remote: FileSignature;
  baseContent?: string;
}

export interface PluginSettings {
  provider: ProviderKind;
  remoteFolder: string;
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKey: string;
  s3SecretKey: string;
  azureSasUrl: string;
  dropboxAppKey: string;
  dropboxRefreshToken: string;
  dropboxAccessToken: string;
  dropboxAccessTokenExpiresAt: number;
  oneDriveClientId: string;
  oneDriveRefreshToken: string;
  oneDriveAccessToken: string;
  oneDriveAccessTokenExpiresAt: number;
  oneDriveFullAccess: boolean;
  yandexDiskToken: string;
  yandexDiskClientId: string;
  pcloudToken: string;
  pcloudRegion: "us" | "eu";
  webdisUrl: string;
  webdisUsername: string;
  webdisPassword: string;
  boxClientId: string;
  boxClientSecret: string;
  boxRedirectUri: string;
  boxAccessToken: string;
  boxRefreshToken: string;
  boxAccessTokenExpiresAt: number;
  googleClientId: string;
  googleClientSecret: string;
  googleRefreshToken: string;
  googleAccessToken: string;
  googleAccessTokenExpiresAt: number;
  autoSync: boolean;
  syncOnSave: boolean;
  scheduledSync: boolean;
  scheduledSyncMinutes: number;
  maxFileSizeMb: number;
  ignorePatterns: string;
  includeUnderscorePaths: boolean;
  syncConfigFolder: boolean;
  syncBookmarks: boolean;
  conflictAction: "keep-newer" | "keep-larger" | "keep-both" | "merge-markdown" | "crdt" | "prefer-local";
  deviceId: string;
  encryptionPassword: string;
  encryptionMethod: EncryptionMethod;
  encryptionMethodTarget: EncryptionMethod;
  syncDeletions: boolean;
  syncDeleteLocation: "obsidian" | "system";
  syncConcurrency: number;
  syncRecoveryPending: boolean;
  ribbonAction: RibbonAction;
  logText: string;
  baseline: Record<string, SyncBaseline>;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  provider: "webdav",
  remoteFolder: "",
  webdavUrl: "",
  webdavUsername: "",
  webdavPassword: "",
  s3Endpoint: "",
  s3Region: "us-east-1",
  s3Bucket: "",
  s3AccessKey: "",
  s3SecretKey: "",
  azureSasUrl: "",
  dropboxAppKey: "",
  dropboxRefreshToken: "",
  dropboxAccessToken: "",
  dropboxAccessTokenExpiresAt: 0,
  oneDriveClientId: "",
  oneDriveRefreshToken: "",
  oneDriveAccessToken: "",
  oneDriveAccessTokenExpiresAt: 0,
  oneDriveFullAccess: false,
  yandexDiskToken: "",
  yandexDiskClientId: "",
  pcloudToken: "",
  pcloudRegion: "us",
  webdisUrl: "",
  webdisUsername: "",
  webdisPassword: "",
  boxClientId: "",
  boxClientSecret: "",
  boxRedirectUri: "http://localhost:53682/callback",
  boxAccessToken: "",
  boxRefreshToken: "",
  boxAccessTokenExpiresAt: 0,
  googleClientId: "",
  googleClientSecret: "",
  googleRefreshToken: "",
  googleAccessToken: "",
  googleAccessTokenExpiresAt: 0,
  autoSync: true,
  syncOnSave: true,
  scheduledSync: false,
  scheduledSyncMinutes: 30,
  maxFileSizeMb: 0,
  ignorePatterns: "",
  includeUnderscorePaths: false,
  syncConfigFolder: false,
  syncBookmarks: false,
  conflictAction: "keep-newer",
  deviceId: "",
  encryptionPassword: "",
  encryptionMethod: "aes-gcm",
  encryptionMethodTarget: "aes-gcm",
  syncDeletions: true,
  syncDeleteLocation: "obsidian",
  syncConcurrency: 5,
  syncRecoveryPending: false,
  ribbonAction: "sync",
  logText: "",
  baseline: {},
};
