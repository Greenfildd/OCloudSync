import { App, Modal, Notice, Platform, requestUrl, Setting } from "obsidian";
import type {
  CloudProvider,
  FileEntry,
  PluginSettings,
} from "./types";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const encoder = new TextEncoder();

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function cleanPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error(`Invalid cloud path: ${path}`);
  }
  return parts.join("/");
}

function encodePath(path: string): string {
  return cleanPath(path).split("/").map(encodeURIComponent).join("/");
}

function assertSuccess(status: number, message: string): void {
  if (status < 200 || status >= 300) {
    throw new Error(`${message} (HTTP ${status})`);
  }
}

function encodeBasicAuth(username: string, password: string): string {
  const bytes = encoder.encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `Basic ${btoa(binary)}`;
}

function findDescendant(element: Element, localName: string): Element | null {
  for (const child of Array.from(element.getElementsByTagName("*"))) {
    if (child.localName === localName) {
      return child;
    }
  }
  return null;
}

export class WebDavProvider implements CloudProvider {
  private readonly baseUrl: URL;
  private readonly rootPath: string;
  private readonly rootUrl: URL;
  private readonly headers: Record<string, string>;

  constructor(settings: PluginSettings) {
    if (!settings.webdavUrl.trim()) {
      throw new Error("Enter a WebDAV server URL in plugin settings.");
    }
    this.baseUrl = new URL(settings.webdavUrl);
    if (
      this.baseUrl.protocol !== "https:" &&
      !(
        this.baseUrl.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(this.baseUrl.hostname)
      )
    ) {
      throw new Error("WebDAV must use HTTPS (HTTP is allowed only on localhost).");
    }
    if (this.baseUrl.username || this.baseUrl.password || this.baseUrl.hash) {
      throw new Error("Put WebDAV credentials in their own settings fields, not in the URL.");
    }
    this.baseUrl.pathname = `${this.baseUrl.pathname.replace(/\/+$/, "")}/`;
    this.rootPath = cleanPath(settings.remoteFolder);
    this.rootUrl = new URL(
      `${this.rootPath ? `${encodePath(this.rootPath)}/` : ""}`,
      this.baseUrl
    );
    this.headers = {};
    if (settings.webdavUsername || settings.webdavPassword) {
      this.headers.Authorization = encodeBasicAuth(
        settings.webdavUsername,
        settings.webdavPassword
      );
    }
  }

  private url(path: string): string {
    const encoded = encodePath(path);
    return new URL(encoded, this.rootUrl).toString();
  }

  private async request(
    url: string,
    method: string,
    body?: string | ArrayBuffer,
    headers: Record<string, string> = {}
  ) {
    return requestUrl({
      url,
      method,
      body,
      headers: { ...this.headers, ...headers },
      throw: false,
    });
  }

  private async ensureFolder(path: string): Promise<void> {
    const parts = cleanPath(path).split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const response = await this.request(`${this.url(current)}/`, "MKCOL");
      if (response.status !== 405 && response.status !== 301) {
        assertSuccess(response.status, `Could not create WebDAV folder "${current}"`);
      }
    }
  }

  private async ensureRootFolder(): Promise<void> {
    let current = this.baseUrl.pathname;
    for (const segment of this.rootPath.split("/").filter(Boolean)) {
      current = `${current.replace(/\/+$/, "")}/${encodeURIComponent(segment)}`;
      const response = await this.request(
        new URL(`${current}/`, this.baseUrl).toString(),
        "MKCOL"
      );
      if (response.status !== 405 && response.status !== 301) {
        assertSuccess(response.status, `Could not create WebDAV folder "${segment}"`);
      }
    }
  }

  async list(): Promise<FileEntry[]> {
    await this.ensureRootFolder();
    const entries: FileEntry[] = [];
    const folders = [""];
    const visited = new Set<string>();

    while (folders.length > 0) {
      const folder = folders.shift()!;
      if (visited.has(folder)) {
        continue;
      }
      visited.add(folder);
      const response = await this.request(
        `${this.url(folder)}${folder ? "/" : ""}`,
        "PROPFIND",
        `<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getlastmodified/><d:getcontentlength/></d:prop></d:propfind>`,
        { Depth: "1", "Content-Type": "application/xml; charset=utf-8" }
      );
      if (response.status !== 207 && response.status !== 200) {
        assertSuccess(response.status, "Could not list WebDAV folder");
      }

      const document = new DOMParser().parseFromString(response.text, "application/xml");
      if (document.getElementsByTagName("parsererror").length > 0) {
        throw new Error("The WebDAV server returned invalid XML.");
      }
      const responses = Array.from(document.getElementsByTagName("*")).filter(
        (element) => element.localName === "response"
      );
      const currentUrl = new URL(`${this.url(folder)}${folder ? "/" : ""}`);

      for (const item of responses) {
        const href = findDescendant(item, "href")?.textContent;
        if (!href) {
          continue;
        }
        const itemUrl = new URL(href, this.baseUrl);
        if (itemUrl.origin !== this.baseUrl.origin) {
          continue;
        }
        const currentPath = decodeURIComponent(itemUrl.pathname).replace(/\/+$/, "");
        const parentPath = decodeURIComponent(currentUrl.pathname).replace(/\/+$/, "");
        if (currentPath === parentPath) {
          continue;
        }
        const rootPrefix = decodeURIComponent(this.rootUrl.pathname).replace(/\/+$/, "");
        if (!currentPath.startsWith(`${rootPrefix}/`)) {
          continue;
        }
        const relative = currentPath.slice(rootPrefix.length + 1);
        const path = cleanPath(relative);
        if (!path || path.includes("/../")) {
          continue;
        }
        const prop = findDescendant(item, "prop");
        const isFolder = !!prop && Array.from(prop.getElementsByTagName("*")).some(
          (element) => element.localName === "collection"
        );
        const modified = findDescendant(item, "getlastmodified")?.textContent;
        const size = findDescendant(item, "getcontentlength")?.textContent;
        if (isFolder) {
          folders.push(path);
        } else {
          entries.push({
            path,
            mtime: modified ? Date.parse(modified) || 0 : 0,
            size: size ? Number.parseInt(size, 10) || 0 : 0,
            isFolder: false,
          });
        }
      }
    }

    return entries;
  }

  async read(path: string): Promise<ArrayBuffer> {
    const response = await this.request(this.url(path), "GET");
    assertSuccess(response.status, `Could not download "${path}" from WebDAV`);
    return response.arrayBuffer;
  }

  async write(path: string, data: ArrayBuffer): Promise<void> {
    const clean = cleanPath(path);
    const parent = clean.split("/").slice(0, -1).join("/");
    if (parent) {
      await this.ensureFolder(parent);
    }
    const response = await this.request(this.url(clean), "PUT", data, {
      "Content-Type": "application/octet-stream",
    });
    assertSuccess(response.status, `Could not upload "${path}" to WebDAV`);
  }

  async delete(path: string): Promise<void> {
    const response = await this.request(this.url(path), "DELETE");
    if (response.status !== 404) assertSuccess(response.status, `Could not delete "${path}" from WebDAV`);
  }
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
}

interface DriveListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function concatenate(parts: Uint8Array[]): ArrayBuffer {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result.buffer;
}

export class GoogleDriveProvider implements CloudProvider {
  private readonly settings: PluginSettings;
  private readonly folderIds = new Map<string, string>();
  private rootFolderId = "";

  constructor(settings: PluginSettings) {
    this.settings = settings;
    if (!settings.googleClientId.trim()) {
      throw new Error("Enter a Google OAuth desktop client ID in plugin settings.");
    }
    if (!settings.googleRefreshToken) {
      throw new Error("Connect a Google account in plugin settings first.");
    }
  }

  private async accessToken(): Promise<string> {
    if (
      this.settings.googleAccessToken &&
      Date.now() < this.settings.googleAccessTokenExpiresAt - 60_000
    ) {
      return this.settings.googleAccessToken;
    }

    const response = await requestUrl({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        client_id: this.settings.googleClientId,
        ...(this.settings.googleClientSecret.trim() ? { client_secret: this.settings.googleClientSecret.trim() } : {}),
        grant_type: "refresh_token",
        refresh_token: this.settings.googleRefreshToken,
      }).toString(),
      throw: false,
    });
    const tokens = response.json as TokenResponse;
    if (response.status < 200 || response.status >= 300 || !tokens.access_token) {
      throw new Error(
        `Google token refresh failed: ${tokens.error_description || tokens.error || response.status}`
      );
    }
    this.settings.googleAccessToken = tokens.access_token;
    this.settings.googleAccessTokenExpiresAt =
      Date.now() + (tokens.expires_in ?? 3600) * 1000;
    return tokens.access_token;
  }

  private async api(
    url: string,
    method = "GET",
    body?: string | ArrayBuffer,
    contentType?: string
  ) {
    const token = await this.accessToken();
    const response = await requestUrl({
      url,
      method,
      body,
      headers: { Authorization: `Bearer ${token}` },
      contentType,
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      const detail = response.text.slice(0, 300);
      throw new Error(`Google Drive request failed (HTTP ${response.status}): ${detail}`);
    }
    return response;
  }

  private async filesInFolder(parentId: string, name?: string): Promise<DriveFile[]> {
    const clauses = [`'${escapeDriveQuery(parentId)}' in parents`, "trashed = false"];
    if (name !== undefined) {
      clauses.push(`name = '${escapeDriveQuery(name)}'`);
    }
    const found: DriveFile[] = [];
    let pageToken = "";
    do {
      const params = new URLSearchParams({
        q: clauses.join(" and "),
        pageSize: "1000",
        fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size)",
        spaces: "drive",
      });
      if (pageToken) {
        params.set("pageToken", pageToken);
      }
      const response = await this.api(`${DRIVE_API}/files?${params.toString()}`);
      const page = response.json as DriveListResponse;
      found.push(...(page.files ?? []));
      pageToken = page.nextPageToken ?? "";
    } while (pageToken);
    return found;
  }

  private async findOrCreateFolder(parentId: string, name: string): Promise<string> {
    const existing = (await this.filesInFolder(parentId, name)).filter(
      (file) => file.mimeType === DRIVE_FOLDER_MIME
    );
    if (existing.length > 1) {
      throw new Error(`Google Drive contains multiple folders named "${name}".`);
    }
    if (existing.length === 1) {
      return existing[0].id;
    }
    const response = await this.api(
      `${DRIVE_API}/files`,
      "POST",
      JSON.stringify({ name, mimeType: DRIVE_FOLDER_MIME, parents: [parentId] }),
      "application/json"
    );
    return (response.json as DriveFile).id;
  }

  private async ensureRootFolder(): Promise<string> {
    if (this.rootFolderId) {
      return this.rootFolderId;
    }
    let parentId = "root";
    let path = "";
    for (const segment of cleanPath(this.settings.remoteFolder).split("/").filter(Boolean)) {
      path = path ? `${path}/${segment}` : segment;
      parentId = await this.findOrCreateFolder(parentId, segment);
      this.folderIds.set(path, parentId);
    }
    this.rootFolderId = parentId;
    return parentId;
  }

  async list(): Promise<FileEntry[]> {
    const rootId = await this.ensureRootFolder();
    const entries: FileEntry[] = [];
    const queue: Array<{ id: string; path: string }> = [{ id: rootId, path: "" }];

    while (queue.length) {
      const folder = queue.shift()!;
      const children = await this.filesInFolder(folder.id);
      const pathsSeen = new Set<string>();
      for (const child of children) {
        const path = cleanPath(folder.path ? `${folder.path}/${child.name}` : child.name);
        if (pathsSeen.has(path)) {
          throw new Error(`Google Drive contains duplicate items at "${path}".`);
        }
        pathsSeen.add(path);
        if (child.mimeType === DRIVE_FOLDER_MIME) {
          this.folderIds.set(path, child.id);
          queue.push({ id: child.id, path });
        } else {
          if (child.mimeType.startsWith("application/vnd.google-apps.")) {
            throw new Error(
              `Google Drive item "${path}" is a native Google document or shortcut, which cannot be synchronized as a regular file.`
            );
          }
          entries.push({
            path,
            mtime: child.modifiedTime ? Date.parse(child.modifiedTime) || 0 : 0,
            size: Number.parseInt(child.size ?? "0", 10) || 0,
            isFolder: false,
          });
        }
      }
    }

    return entries;
  }

  async read(path: string): Promise<ArrayBuffer> {
    const file = (await this.findItem(path)).file;
    if (!file) {
      throw new Error(`Google Drive file not found: ${path}`);
    }
    const response = await this.api(`${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`);
    return response.arrayBuffer;
  }

  private async findItem(
    path: string
  ): Promise<{ file: DriveFile | undefined; parentId: string }> {
    const clean = cleanPath(path);
    const parts = clean.split("/");
    let parentId = await this.ensureRootFolder();
    for (const [index, part] of parts.slice(0, -1).entries()) {
      const childPath = parts.slice(0, index + 1).join("/");
      const cachedId = this.folderIds.get(childPath);
      if (cachedId) {
        parentId = cachedId;
      } else {
        const folders = (await this.filesInFolder(parentId, part)).filter(
          (file) => file.mimeType === DRIVE_FOLDER_MIME
        );
        if (folders.length === 0) return { file: undefined, parentId };
        if (folders.length > 1) throw new Error(`Google Drive contains multiple folders named "${part}".`);
        parentId = folders[0].id;
        this.folderIds.set(childPath, parentId);
      }
    }
    const matches = (await this.filesInFolder(parentId, parts[parts.length - 1])).filter(
      (file) => file.mimeType !== DRIVE_FOLDER_MIME
    );
    if (matches.length > 1) {
      throw new Error(`Google Drive contains multiple files named "${clean}".`);
    }
    return { file: matches[0], parentId };
  }

  async write(path: string, data: ArrayBuffer, mtime: number): Promise<void> {
    const clean = cleanPath(path);
    const parts = clean.split("/");
    let parentId = await this.ensureRootFolder();
    let parentPath = "";
    for (const segment of parts.slice(0, -1)) {
      parentPath = parentPath ? `${parentPath}/${segment}` : segment;
      let id = this.folderIds.get(parentPath);
      if (!id) {
        id = await this.findOrCreateFolder(parentId, segment);
        this.folderIds.set(parentPath, id);
      }
      parentId = id;
    }

    const existing = (await this.filesInFolder(parentId, parts[parts.length - 1])).filter(
      (file) => file.mimeType !== DRIVE_FOLDER_MIME
    );
    if (existing.length > 1) {
      throw new Error(`Google Drive contains multiple files named "${clean}".`);
    }
    const boundary = `my-cloud-sync-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({
      name: parts[parts.length - 1],
      ...(existing.length ? {} : { parents: [parentId] }),
      modifiedTime: new Date(mtime).toISOString(),
    });
    const prefix = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`
    );
    const suffix = encoder.encode(`\r\n--${boundary}--`);
    const method = existing.length ? "PATCH" : "POST";
    const url = existing.length
      ? `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(existing[0].id)}?uploadType=multipart`
      : `${DRIVE_UPLOAD_API}/files?uploadType=multipart`;
    await this.api(url, method, concatenate([prefix, new Uint8Array(data), suffix]), `multipart/related; boundary=${boundary}`);
  }

  async delete(path: string): Promise<void> {
    const { file } = await this.findItem(path);
    if (file) await this.api(`${DRIVE_API}/files/${encodeURIComponent(file.id)}`, "DELETE");
  }
}

export class S3Provider implements CloudProvider {
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly region: string;
  private readonly endpoint?: URL;
  private readonly accessKey: string;
  private readonly secretKey: string;

  constructor(settings: PluginSettings) {
    if (!settings.s3Bucket.trim() || !settings.s3AccessKey.trim() || !settings.s3SecretKey) {
      throw new Error("Enter the S3 bucket, access key, and secret key in plugin settings.");
    }
    if (settings.s3Endpoint.trim()) {
      const endpoint = new URL(settings.s3Endpoint);
      if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname))) {
        throw new Error("S3 endpoint must use HTTPS (HTTP is allowed only on localhost).");
      }
      if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("S3 endpoint must not contain credentials, query parameters, or a fragment.");
    }
    this.bucket = settings.s3Bucket.trim();
    this.prefix = cleanPath(settings.remoteFolder);
    this.region = settings.s3Region.trim() || "us-east-1";
    this.endpoint = settings.s3Endpoint.trim() ? new URL(settings.s3Endpoint) : undefined;
    this.accessKey = settings.s3AccessKey.trim();
    this.secretKey = settings.s3SecretKey;
  }

  private key(path: string): string {
    const relative = cleanPath(path);
    return [this.prefix, relative].filter(Boolean).join("/");
  }

  private async signedRequest(method: string, key = "", query: Record<string, string> = {}, body?: ArrayBuffer) {
    const url = this.endpoint ? new URL(this.endpoint.toString()) : new URL(`https://${this.bucket}.s3.${this.region}.amazonaws.com`);
    const basePath = url.pathname.replace(/\/+$/, "");
    const pathStyle = !!this.endpoint || this.bucket.includes(".");
    if (!this.endpoint && pathStyle) url.hostname = `s3.${this.region}.amazonaws.com`;
    const objectPath = [pathStyle ? this.bucket : "", key].filter(Boolean).join("/");
    url.pathname = `${basePath}${objectPath ? `/${objectPath.split("/").map(awsEncode).join("/")}` : "/"}`;
    const queryParts = Object.entries(query).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${awsEncode(name)}=${awsEncode(value)}`);
    url.search = queryParts.join("&");
    const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const day = timestamp.slice(0, 8);
    const payload = body ? new Uint8Array(body) : new Uint8Array();
    const payloadHash = await sha256Hex(payload);
    const headers: Record<string, string> = {
      "x-amz-date": timestamp,
      "x-amz-content-sha256": payloadHash,
    };
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalHeaders = `host:${url.host.toLowerCase()}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${timestamp}\n`;
    const canonicalRequest = [method, url.pathname, url.search.slice(1), canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${day}/${this.region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${await sha256Hex(encoder.encode(canonicalRequest))}`;
    const dateKey = await hmacSha256(encoder.encode(`AWS4${this.secretKey}`), day);
    const regionKey = await hmacSha256(dateKey, this.region);
    const serviceKey = await hmacSha256(regionKey, "s3");
    const signingKey = await hmacSha256(serviceKey, "aws4_request");
    const signature = toHex(new Uint8Array(await hmacSha256(signingKey, stringToSign)));
    headers.Authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    if (method === "PUT") headers["Content-Type"] = "application/octet-stream";
    const response = await requestUrl({ url: url.toString(), method, headers, body, throw: false });
    return response;
  }

  async list(): Promise<FileEntry[]> {
    const result: FileEntry[] = [];
    let token: string | undefined;
    const prefix = this.prefix ? `${this.prefix}/` : "";
    do {
      const query: Record<string, string> = { "list-type": "2", prefix };
      if (token) query["continuation-token"] = token;
      const page = await this.signedRequest("GET", "", query);
      assertSuccess(page.status, "Could not list S3 bucket");
      const document = new DOMParser().parseFromString(page.text, "application/xml");
      if (document.getElementsByTagName("parsererror").length) throw new Error("S3 returned invalid listing XML.");
      for (const item of Array.from(document.getElementsByTagName("Contents"))) {
        const key = findDescendant(item, "Key")?.textContent ?? "";
        if (!key || key.endsWith("/")) continue;
        const path = this.prefix ? key.slice(prefix.length) : key;
        if (!path || path.startsWith("/") || path.split("/").some((part) => part === ".." || part === ".")) continue;
        const modified = findDescendant(item, "LastModified")?.textContent;
        const size = findDescendant(item, "Size")?.textContent;
        result.push({ path, mtime: modified ? Date.parse(modified) || 0 : 0, size: size ? Number.parseInt(size, 10) || 0 : 0, isFolder: false });
      }
      const truncated = findDescendant(document.documentElement, "IsTruncated")?.textContent === "true";
      token = truncated ? findDescendant(document.documentElement, "NextContinuationToken")?.textContent ?? undefined : undefined;
    } while (token);
    return result;
  }

  async read(path: string): Promise<ArrayBuffer> {
    const response = await this.signedRequest("GET", this.key(path));
    assertSuccess(response.status, `Could not download S3 object "${path}"`);
    return response.arrayBuffer;
  }

  async write(path: string, data: ArrayBuffer): Promise<void> {
    const response = await this.signedRequest("PUT", this.key(path), {}, data);
    assertSuccess(response.status, `Could not upload S3 object "${path}"`);
  }

  async delete(path: string): Promise<void> {
    const response = await this.signedRequest("DELETE", this.key(path));
    if (response.status !== 404) assertSuccess(response.status, `Could not delete S3 object "${path}"`);
  }
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: BufferSource): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", value)));
}

async function hmacSha256(keyBytes: BufferSource, value: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, encoder.encode(value));
}

export class AzureBlobProvider implements CloudProvider {
  private readonly containerUrl: URL;
  private readonly prefix: string;

  constructor(settings: PluginSettings) {
    if (!settings.azureSasUrl.trim()) throw new Error("Enter an Azure Blob container SAS URL.");
    this.containerUrl = new URL(settings.azureSasUrl.trim());
    if (this.containerUrl.protocol !== "https:") throw new Error("Azure Blob requires an HTTPS SAS URL.");
    if (this.containerUrl.username || this.containerUrl.password || this.containerUrl.hash) throw new Error("Azure SAS URL must not contain embedded credentials or a fragment.");
    if (!this.containerUrl.searchParams.has("sig")) throw new Error("The Azure URL must include a container SAS token with a sig parameter.");
    this.prefix = cleanPath(settings.remoteFolder);
  }

  private url(path: string, query?: Record<string, string>, includePrefix = true): string {
    const key = [includePrefix ? this.prefix : "", cleanPath(path)].filter(Boolean).join("/");
    const base = new URL(this.containerUrl.toString());
    base.pathname = `${base.pathname.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
    for (const [name, value] of Object.entries(query ?? {})) base.searchParams.set(name, value);
    return base.toString();
  }

  private async request(url: string, method: string, body?: ArrayBuffer, headers: Record<string, string> = {}) {
    return requestUrl({ url, method, body, headers, throw: false });
  }

  async list(): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];
    let marker = "";
    const prefix = [this.prefix, ""].filter(Boolean).join("/");
    do {
      const query: Record<string, string> = { restype: "container", comp: "list", prefix: prefix ? `${prefix}/` : "" };
      if (marker) query.marker = marker;
      const response = await this.request(this.url("", query, false), "GET", undefined, { "x-ms-version": "2023-11-03" });
      assertSuccess(response.status, "Could not list Azure Blob container");
      const document = new DOMParser().parseFromString(response.text, "application/xml");
      if (document.getElementsByTagName("parsererror").length) throw new Error("Azure returned invalid blob listing XML.");
      for (const blob of Array.from(document.getElementsByTagName("Blob"))) {
        const name = blob.getElementsByTagName("Name")[0]?.textContent ?? "";
        if (!name.startsWith(prefix ? `${prefix}/` : "")) continue;
        const path = this.prefix ? name.slice(this.prefix.length + 1) : name;
        if (!path || path.split("/").some((part) => part === "." || part === "..")) continue;
        const properties = blob.getElementsByTagName("Properties")[0];
        const modified = properties?.getElementsByTagName("Last-Modified")[0]?.textContent;
        const size = properties?.getElementsByTagName("Content-Length")[0]?.textContent;
        entries.push({ path, mtime: modified ? Date.parse(modified) || 0 : 0, size: size ? Number.parseInt(size, 10) || 0 : 0, isFolder: false });
      }
      marker = document.getElementsByTagName("NextMarker")[0]?.textContent ?? "";
    } while (marker);
    return entries;
  }

  async read(path: string): Promise<ArrayBuffer> {
    const response = await this.request(this.url(path), "GET", undefined, { "x-ms-version": "2023-11-03" });
    assertSuccess(response.status, `Could not download Azure blob "${path}"`);
    return response.arrayBuffer;
  }

  async write(path: string, data: ArrayBuffer): Promise<void> {
    const response = await this.request(this.url(path), "PUT", data, {
      "x-ms-version": "2023-11-03",
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": "application/octet-stream",
    });
    assertSuccess(response.status, `Could not upload Azure blob "${path}"`);
  }

  async delete(path: string): Promise<void> {
    const response = await this.request(this.url(path), "DELETE", undefined, { "x-ms-version": "2023-11-03" });
    if (response.status !== 404) assertSuccess(response.status, `Could not delete Azure blob "${path}"`);
  }
}

interface DropboxEntry {
  ".tag": string;
  name: string;
  path_display?: string;
  size?: number;
  client_modified?: string;
}

export class DropboxProvider implements CloudProvider {
  private readonly settings: PluginSettings;
  private readonly root: string;

  constructor(settings: PluginSettings) {
    if (!settings.dropboxAppKey.trim() || !settings.dropboxRefreshToken) {
      throw new Error("Set the Dropbox app key and connect your account in plugin settings.");
    }
    this.settings = settings;
    this.root = cleanPath(settings.remoteFolder);
  }

  private async accessToken(): Promise<string> {
    if (this.settings.dropboxAccessToken && Date.now() < this.settings.dropboxAccessTokenExpiresAt - 60_000) return this.settings.dropboxAccessToken;
    const response = await requestUrl({
      url: "https://api.dropbox.com/oauth2/token",
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        client_id: this.settings.dropboxAppKey.trim(),
        grant_type: "refresh_token",
        refresh_token: this.settings.dropboxRefreshToken,
      }).toString(),
      throw: false,
    });
    const data = response.json as { access_token?: string; expires_in?: number; error_description?: string };
    if (response.status < 200 || response.status >= 300 || !data.access_token) throw new Error(`Dropbox token refresh failed: ${data.error_description ?? response.status}`);
    this.settings.dropboxAccessToken = data.access_token;
    this.settings.dropboxAccessTokenExpiresAt = Date.now() + (data.expires_in ?? 14_400) * 1000;
    return data.access_token;
  }

  private async api(endpoint: string, arg: unknown, body?: ArrayBuffer, contentEndpoint = false, allowConflict = false) {
    const token = await this.accessToken();
    const response = await requestUrl({
      url: `${contentEndpoint ? "https://content.dropboxapi.com" : "https://api.dropboxapi.com"}/2/${endpoint}`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Dropbox-API-Arg": JSON.stringify(arg),
        ...(contentEndpoint ? { "Content-Type": "application/octet-stream" } : {}),
      },
      contentType: contentEndpoint ? undefined : "application/json",
      body,
      throw: false,
    });
    if (allowConflict && response.status === 409) return response;
    if (response.status < 200 || response.status >= 300) throw new Error(`Dropbox ${endpoint} failed (HTTP ${response.status}): ${response.text.slice(0, 250)}`);
    return response;
  }

  private path(path: string): string {
    return `/${[this.root, cleanPath(path)].filter(Boolean).join("/")}`;
  }

  private async ensureFolder(path: string): Promise<void> {
    let current = "";
    for (const segment of cleanPath(path).split("/").filter(Boolean)) {
      current = current ? `${current}/${segment}` : segment;
      await this.api("files/create_folder_v2", { path: `/${current}`, autorename: false }, undefined, false, true);
    }
  }

  async list(): Promise<FileEntry[]> {
    await this.ensureFolder(this.root);
    const entries: FileEntry[] = [];
    let page = await this.api("files/list_folder", { path: this.root ? `/${this.root}` : "", recursive: true, include_deleted: false });
    let data = page.json as { entries?: DropboxEntry[]; has_more?: boolean; cursor?: string };
    const addEntries = (items: DropboxEntry[]) => {
      for (const item of items) {
        if (item[".tag"] !== "file" || !item.path_display) continue;
        const rootPrefix = this.root ? `/${this.root}/` : "/";
        if (!item.path_display.startsWith(rootPrefix)) continue;
        const path = item.path_display.slice(rootPrefix.length);
        entries.push({ path, mtime: item.client_modified ? Date.parse(item.client_modified) || 0 : 0, size: item.size ?? 0, isFolder: false });
      }
    };
    addEntries(data.entries ?? []);
    while (data.has_more && data.cursor) {
      page = await this.api("files/list_folder/continue", { cursor: data.cursor });
      data = page.json as typeof data;
      addEntries(data.entries ?? []);
    }
    return entries;
  }

  async read(path: string): Promise<ArrayBuffer> {
    return (await this.api("files/download", { path: this.path(path) }, undefined, true)).arrayBuffer;
  }

  async write(path: string, data: ArrayBuffer, mtime: number): Promise<void> {
    const parent = cleanPath(path).split("/").slice(0, -1).join("/");
    await this.ensureFolder([this.root, parent].filter(Boolean).join("/"));
    await this.api("files/upload", {
      path: this.path(path), mode: "overwrite", autorename: false, mute: true, strict_conflict: true,
      client_modified: new Date(mtime).toISOString(),
    }, data, true);
  }

  async delete(path: string): Promise<void> {
    await this.api("files/delete_v2", { path: this.path(path) });
  }
}

class AuthorizationCodeModal extends Modal {
  private code = "";
  private settled = false;
  constructor(app: App, private readonly provider: string, private readonly finish: (code: string) => void) { super(app); }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: `Connect ${this.provider}` });
    this.contentEl.createEl("p", { text: "Complete sign-in in the browser, copy the authorization code, then paste it here." });
    new Setting(this.contentEl).setName("Authorization code").addText((text) => {
      text.setPlaceholder("Paste code").onChange((value) => { this.code = value.trim(); });
    });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Connect").setCta().onClick(() => {
      if (!this.code) { new Notice("Paste the authorization code first."); return; }
      this.settled = true;
      this.finish(this.code);
      this.close();
    }));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) this.finish("");
  }
}

function requestDropboxCode(app: App, authUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const modal = new AuthorizationCodeModal(app, "Dropbox", resolve);
    modal.open();
    window.open(authUrl);
  });
}

export async function connectDropbox(settings: PluginSettings, app: App): Promise<void> {
  if (!settings.dropboxAppKey.trim()) throw new Error("Enter a Dropbox app key before connecting.");
  const redirectUri = "http://localhost:53683/dropbox-callback";
  const http = Platform.isDesktop ? await import("http") : undefined;
  const verifierBytes = crypto.getRandomValues(new Uint8Array(48));
  const verifier = btoa(String.fromCharCode(...verifierBytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const challengeBytes = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const authUrl = new URL("https://www.dropbox.com/oauth2/authorize");
  authUrl.search = new URLSearchParams({
    client_id: settings.dropboxAppKey.trim(),
    ...(Platform.isMobile ? {} : { redirect_uri: redirectUri }),
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
    scope: "account_info.read files.metadata.read files.content.read files.content.write",
  }).toString();
  const state = Array.from(crypto.getRandomValues(new Uint8Array(24))).map((value) => value.toString(16).padStart(2, "0")).join("");
  if (!Platform.isMobile) authUrl.searchParams.set("state", state);
  const code = Platform.isMobile
    ? await requestDropboxCode(app, authUrl.toString())
    : await new Promise<string>((resolve, reject) => {
    if (!http) { reject(new Error("Local OAuth callback is unavailable.")); return; }
    let settled = false;
    const server = http.createServer((request, response) => {
      const callback = new URL(request.url ?? "/", redirectUri);
      if (callback.pathname !== "/dropbox-callback") { response.writeHead(404).end("Not found."); return; }
      if (callback.searchParams.get("state") !== state) { response.writeHead(400).end("Sign-in state mismatch."); return; }
      const error = callback.searchParams.get("error");
      const returnedCode = callback.searchParams.get("code");
      if (error || !returnedCode) {
        response.writeHead(400).end("Dropbox sign-in was cancelled. Return to Obsidian.");
        settled = true; window.clearTimeout(timeout); server.close();
        reject(new Error(error ? `Dropbox sign-in failed: ${error}` : "Dropbox did not return an authorization code."));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("<p>Dropbox connected. Return to Obsidian.</p>");
      settled = true; window.clearTimeout(timeout); server.close(); resolve(returnedCode);
    });
    const timeout = window.setTimeout(() => { if (!settled) { settled = true; server.close(); reject(new Error("Dropbox sign-in timed out.")); } }, 5 * 60_000);
    server.once("error", (error) => { if (!settled) { settled = true; window.clearTimeout(timeout); reject(new Error(`Could not start Dropbox sign-in: ${error.message}`)); } });
    server.listen(53683, "127.0.0.1", () => window.open(authUrl.toString()));
  });
  const response = await requestUrl({
    url: "https://api.dropbox.com/oauth2/token",
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams({
      client_id: settings.dropboxAppKey.trim(),
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      ...(!Platform.isMobile ? { redirect_uri: redirectUri } : {}),
    }).toString(),
    throw: false,
  });
  const data = response.json as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (response.status < 200 || response.status >= 300 || !data.refresh_token || !data.access_token) {
    throw new Error(`Dropbox connection failed: ${data.error_description ?? response.status}`);
  }
  settings.dropboxRefreshToken = data.refresh_token;
  settings.dropboxAccessToken = data.access_token;
  settings.dropboxAccessTokenExpiresAt = Date.now() + (data.expires_in ?? 14_400) * 1000;
}

interface GraphItem {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  folder?: Record<string, unknown>;
  file?: Record<string, unknown>;
  "@microsoft.graph.downloadUrl"?: string;
}

interface GraphPage {
  value?: GraphItem[];
  "@odata.nextLink"?: string;
}

export class OneDriveProvider implements CloudProvider {
  private readonly settings: PluginSettings;
  private rootId = "";

  constructor(settings: PluginSettings) {
    if (!settings.oneDriveClientId.trim() || !settings.oneDriveRefreshToken) throw new Error("Set the Microsoft client ID and connect OneDrive in plugin settings.");
    this.settings = settings;
  }

  private async accessToken(): Promise<string> {
    if (this.settings.oneDriveAccessToken && Date.now() < this.settings.oneDriveAccessTokenExpiresAt - 60_000) return this.settings.oneDriveAccessToken;
    const response = await requestUrl({
      url: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        client_id: this.settings.oneDriveClientId.trim(),
        grant_type: "refresh_token",
        refresh_token: this.settings.oneDriveRefreshToken,
        scope: "Files.ReadWrite.AppFolder offline_access",
      }).toString(),
      throw: false,
    });
    const data = response.json as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
    if (response.status < 200 || response.status >= 300 || !data.access_token) throw new Error(`OneDrive token refresh failed: ${data.error_description ?? response.status}`);
    this.settings.oneDriveAccessToken = data.access_token;
    if (data.refresh_token) this.settings.oneDriveRefreshToken = data.refresh_token;
    this.settings.oneDriveAccessTokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    return data.access_token;
  }

  private async graph(url: string, method = "GET", body?: string | ArrayBuffer, contentType?: string) {
    const response = await requestUrl({
      url: url.startsWith("http") ? url : `https://graph.microsoft.com/v1.0${url}`,
      method,
      body,
      headers: { Authorization: `Bearer ${await this.accessToken()}` },
      contentType,
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`Microsoft Graph request failed (HTTP ${response.status}): ${response.text.slice(0, 250)}`);
    return response;
  }

  private async children(parentId: string): Promise<GraphItem[]> {
    const items: GraphItem[] = [];
    let next = `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(parentId)}/children?$top=999`;
    do {
      const page = (await this.graph(next)).json as GraphPage;
      items.push(...(page.value ?? []));
      next = page["@odata.nextLink"] ?? "";
    } while (next);
    return items;
  }

  private async rootFolder(): Promise<string> {
    if (this.rootId) return this.rootId;
    const driveRoot = this.settings.oneDriveFullAccess
      ? "/me/drive/root?$select=id"
      : "/me/drive/special/approot?$select=id";
    let parent = ((await this.graph(driveRoot)).json as GraphItem).id;
    for (const segment of cleanPath(this.settings.remoteFolder).split("/").filter(Boolean)) {
      const existing = (await this.children(parent)).filter((item) => item.name === segment && !!item.folder);
      if (existing.length > 1) throw new Error(`OneDrive has duplicate folders named "${segment}".`);
      if (existing.length) parent = existing[0].id;
      else {
        const created = await this.graph(`/me/drive/items/${encodeURIComponent(parent)}/children`, "POST", JSON.stringify({ name: segment, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }), "application/json");
        parent = (created.json as GraphItem).id;
      }
    }
    this.rootId = parent;
    return parent;
  }

  async list(): Promise<FileEntry[]> {
    const output: FileEntry[] = [];
    const queue: Array<{ id: string; path: string }> = [{ id: await this.rootFolder(), path: "" }];
    while (queue.length) {
      const folder = queue.shift()!;
      for (const item of await this.children(folder.id)) {
        const path = cleanPath(folder.path ? `${folder.path}/${item.name}` : item.name);
        if (item.folder) queue.push({ id: item.id, path });
        else if (item.file) output.push({ path, mtime: item.lastModifiedDateTime ? Date.parse(item.lastModifiedDateTime) || 0 : 0, size: item.size ?? 0, isFolder: false });
      }
    }
    return output;
  }

  async read(path: string): Promise<ArrayBuffer> {
    const pathInDrive = cleanPath([this.settings.remoteFolder, path].filter(Boolean).join("/")).split("/").map(encodeURIComponent).join("/");
    const root = this.settings.oneDriveFullAccess ? "root" : "special/approot";
    const item = (await this.graph(`/me/drive/${root}:/${pathInDrive}?$select=id,@microsoft.graph.downloadUrl`)).json as GraphItem;
    if (!item["@microsoft.graph.downloadUrl"]) throw new Error(`OneDrive did not return a download URL for "${path}".`);
    return (await requestUrl({ url: item["@microsoft.graph.downloadUrl"], method: "GET", throw: false })).arrayBuffer;
  }

  async write(path: string, data: ArrayBuffer): Promise<void> {
    const parts = cleanPath(path).split("/");
    let parent = await this.rootFolder();
    for (const segment of parts.slice(0, -1)) {
      const matches = (await this.children(parent)).filter((item) => item.name === segment && !!item.folder);
      if (matches.length) parent = matches[0].id;
      else {
        const created = await this.graph(`/me/drive/items/${encodeURIComponent(parent)}/children`, "POST", JSON.stringify({ name: segment, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }), "application/json");
        parent = (created.json as GraphItem).id;
      }
    }
    const filename = encodeURIComponent(parts[parts.length - 1]);
    await this.graph(`/me/drive/items/${encodeURIComponent(parent)}:/${filename}:/content`, "PUT", data, "application/octet-stream");
  }

  async delete(path: string): Promise<void> {
    const pathInDrive = cleanPath([this.settings.remoteFolder, path].filter(Boolean).join("/")).split("/").map(encodeURIComponent).join("/");
    const root = this.settings.oneDriveFullAccess ? "root" : "special/approot";
    const item = (await this.graph(`/me/drive/${root}:/${pathInDrive}?$select=id`)).json as GraphItem;
    await this.graph(`/me/drive/items/${encodeURIComponent(item.id)}`, "DELETE");
  }
}

class DeviceCodeModal extends Modal {
  constructor(app: App, private readonly userCode: string, private readonly verificationUri: string) { super(app); }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Connect OneDrive" });
    this.contentEl.createEl("p", { text: "Open Microsoft sign-in, enter this code, and approve access. Keep Obsidian open while it waits for confirmation." });
    this.contentEl.createEl("pre", { text: this.userCode, cls: "ocs-device-code" });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Open Microsoft sign-in").setCta().onClick(() => window.open(this.verificationUri)));
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Close").onClick(() => this.close()));
  }

  onClose(): void { this.contentEl.empty(); }
}

async function connectOneDriveMobile(settings: PluginSettings, app: App): Promise<void> {
  const clientId = settings.oneDriveClientId.trim();
  const scope = `${settings.oneDriveFullAccess ? "Files.ReadWrite" : "Files.ReadWrite.AppFolder"} offline_access`;
  const deviceResponse = await requestUrl({
    url: "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode",
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams({ client_id: clientId, scope }).toString(),
    throw: false,
  });
  const device = deviceResponse.json as { device_code?: string; user_code?: string; verification_uri?: string; message?: string; expires_in?: number; interval?: number; error?: string; error_description?: string };
  if (deviceResponse.status < 200 || deviceResponse.status >= 300 || !device.device_code || !device.user_code || !device.verification_uri) {
    throw new Error(device.error_description ?? device.error ?? `Microsoft device sign-in could not start (HTTP ${deviceResponse.status}). Confirm device code flow is enabled for a public client.`);
  }
  new DeviceCodeModal(app, device.user_code, device.verification_uri).open();

  const expiresAt = Date.now() + (device.expires_in ?? 900) * 1000;
  let interval = Math.max(5, device.interval ?? 5);
  while (Date.now() < expiresAt) {
    await new Promise((resolve) => window.setTimeout(resolve, interval * 1000));
    const response = await requestUrl({
      url: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: clientId,
        device_code: device.device_code,
      }).toString(),
      throw: false,
    });
    const token = response.json as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (response.status >= 200 && response.status < 300 && token.access_token && token.refresh_token) {
      settings.oneDriveAccessToken = token.access_token;
      settings.oneDriveRefreshToken = token.refresh_token;
      settings.oneDriveAccessTokenExpiresAt = Date.now() + (token.expires_in ?? 3600) * 1000;
      return;
    }
    if (token.error === "authorization_pending") continue;
    if (token.error === "slow_down") { interval += 5; continue; }
    throw new Error(token.error_description ?? token.error ?? `Microsoft sign-in failed (HTTP ${response.status}).`);
  }
  throw new Error("Microsoft sign-in code expired. Start the connection again.");
}

export async function connectOneDrive(settings: PluginSettings, app: App): Promise<void> {
  if (!settings.oneDriveClientId.trim()) throw new Error("Enter a Microsoft application client ID before connecting.");
  if (Platform.isMobile) return connectOneDriveMobile(settings, app);
  const http = await import("http");
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(48))).map((value) => value.toString(16).padStart(2, "0")).join("");
  const challengeBytes = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const state = Array.from(crypto.getRandomValues(new Uint8Array(24))).map((value) => value.toString(16).padStart(2, "0")).join("");
  const callback = new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    let settled = false;
    const server = http.createServer((request, response) => {
      const address = server.address();
      if (!address || typeof address === "string") return;
      const redirectUri = `http://localhost:${address.port}`;
      const url = new URL(request.url ?? "/", redirectUri);
      if (url.pathname !== "/") { response.writeHead(404).end("Not found."); return; }
      if (url.searchParams.get("state") !== state) {
        response.writeHead(400).end("OAuth state mismatch.");
        settled = true; window.clearTimeout(timeout); server.close(); reject(new Error("Microsoft sign-in state did not match."));
        return;
      }
      const oauthError = url.searchParams.get("error");
      if (oauthError) {
        response.writeHead(400).end("Microsoft sign-in was cancelled or denied.");
        settled = true; window.clearTimeout(timeout); server.close();
        reject(new Error(url.searchParams.get("error_description") ?? `Microsoft sign-in failed: ${oauthError}`));
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        response.writeHead(400).end("Microsoft did not return a code.");
        settled = true; window.clearTimeout(timeout); server.close(); reject(new Error("Microsoft did not return an authorization code."));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("<p>OneDrive connected. Return to Obsidian.</p>");
      settled = true; window.clearTimeout(timeout); server.close(); resolve({ code, redirectUri });
    });
    const timeout = window.setTimeout(() => { if (!settled) { settled = true; server.close(); reject(new Error("Microsoft sign-in timed out.")); } }, 5 * 60_000);
    server.once("error", (error) => { if (!settled) { settled = true; window.clearTimeout(timeout); reject(error); } });
    server.listen(0, "localhost", () => {
      const address = server.address();
      if (!address || typeof address === "string") { window.clearTimeout(timeout); server.close(); reject(new Error("Could not start the Microsoft sign-in callback.")); return; }
      const redirectUri = `http://localhost:${address.port}`;
      const auth = new URL("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize");
      auth.search = new URLSearchParams({
        client_id: settings.oneDriveClientId.trim(),
        response_type: "code",
        redirect_uri: redirectUri,
        response_mode: "query",
        scope: `${settings.oneDriveFullAccess ? "Files.ReadWrite" : "Files.ReadWrite.AppFolder"} offline_access`,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
      }).toString();
      window.open(auth.toString());
    });
  });
  const { code, redirectUri } = await callback;
  const response = await requestUrl({
    url: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams({
      client_id: settings.oneDriveClientId.trim(), code, code_verifier: verifier,
      grant_type: "authorization_code", redirect_uri: redirectUri,
      scope: `${settings.oneDriveFullAccess ? "Files.ReadWrite" : "Files.ReadWrite.AppFolder"} offline_access`,
    }).toString(),
    throw: false,
  });
  const data = response.json as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (response.status < 200 || response.status >= 300 || !data.access_token || !data.refresh_token) throw new Error(`OneDrive sign-in failed: ${data.error_description ?? response.status}`);
  settings.oneDriveAccessToken = data.access_token;
  settings.oneDriveRefreshToken = data.refresh_token;
  settings.oneDriveAccessTokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
}

interface YandexResource {
  name: string;
  path: string;
  type: "dir" | "file";
  modified?: string;
  size?: number;
}

interface YandexResourcePage {
  _embedded?: { items?: YandexResource[]; total?: number };
}

export class YandexDiskProvider implements CloudProvider {
  private readonly token: string;
  private readonly root: string;

  constructor(settings: PluginSettings) {
    if (!settings.yandexDiskToken.trim()) throw new Error("Enter a Yandex Disk OAuth token in plugin settings.");
    this.token = settings.yandexDiskToken.trim();
    this.root = cleanPath(settings.remoteFolder);
  }

  private remotePath(path: string): string {
    const full = [this.root, cleanPath(path)].filter(Boolean).join("/");
    return full ? `disk:/${full}` : "disk:/";
  }

  private async api(url: string, method = "GET", body?: string | ArrayBuffer) {
    return requestUrl({
      url,
      method,
      body,
      headers: { Authorization: `OAuth ${this.token}` },
      throw: false,
    });
  }

  private async ensureFolder(path: string): Promise<void> {
    let current = "";
    for (const segment of cleanPath(path).split("/").filter(Boolean)) {
      current = current ? `${current}/${segment}` : segment;
      const response = await this.api(`https://cloud-api.yandex.net/v1/disk/resources?${new URLSearchParams({ path: `disk:/${current}` })}`, "PUT");
      if (response.status !== 409) assertSuccess(response.status, `Could not create Yandex Disk folder "${current}"`);
    }
  }

  async list(): Promise<FileEntry[]> {
    await this.ensureFolder(this.root);
    const output: FileEntry[] = [];
    const queue = [this.root ? `disk:/${this.root}` : "disk:/"];
    while (queue.length) {
      const folderPath = queue.shift()!;
      let offset = 0;
      let total = Number.POSITIVE_INFINITY;
      while (offset < total) {
        const params = new URLSearchParams({ path: folderPath, limit: "1000", offset: String(offset), fields: "_embedded.items.name,_embedded.items.path,_embedded.items.type,_embedded.items.modified,_embedded.items.size,_embedded.total" });
        const response = await this.api(`https://cloud-api.yandex.net/v1/disk/resources?${params}`);
        assertSuccess(response.status, "Could not list Yandex Disk folder");
        const page = response.json as YandexResourcePage;
        const items = page._embedded?.items ?? [];
        total = page._embedded?.total ?? items.length;
        for (const item of items) {
          if (item.type === "dir") queue.push(item.path);
          else if (item.type === "file") {
            const fullPrefix = this.root ? `disk:/${this.root}/` : "disk:/";
            if (!item.path.startsWith(fullPrefix)) continue;
            const path = item.path.slice(fullPrefix.length);
            output.push({ path, mtime: item.modified ? Date.parse(item.modified) || 0 : 0, size: item.size ?? 0, isFolder: false });
          }
        }
        offset += items.length;
        if (!items.length) break;
      }
    }
    return output;
  }

  async read(path: string): Promise<ArrayBuffer> {
    const response = await this.api(`https://cloud-api.yandex.net/v1/disk/resources/download?${new URLSearchParams({ path: this.remotePath(path) })}`);
    assertSuccess(response.status, `Could not prepare Yandex Disk download for "${path}"`);
    const href = (response.json as { href?: string }).href;
    if (!href) throw new Error(`Yandex Disk did not return a download link for "${path}".`);
    const download = await requestUrl({ url: href, method: "GET", throw: false });
    assertSuccess(download.status, `Could not download Yandex Disk file "${path}"`);
    return download.arrayBuffer;
  }

  async write(path: string, data: ArrayBuffer): Promise<void> {
    const parent = cleanPath(path).split("/").slice(0, -1).join("/");
    await this.ensureFolder([this.root, parent].filter(Boolean).join("/"));
    const response = await this.api(`https://cloud-api.yandex.net/v1/disk/resources/upload?${new URLSearchParams({ path: this.remotePath(path), overwrite: "true" })}`);
    assertSuccess(response.status, `Could not prepare Yandex Disk upload for "${path}"`);
    const href = (response.json as { href?: string }).href;
    if (!href) throw new Error(`Yandex Disk did not return an upload link for "${path}".`);
    const upload = await requestUrl({ url: href, method: "PUT", body: data, headers: { "Content-Type": "application/octet-stream" }, throw: false });
    assertSuccess(upload.status, `Could not upload Yandex Disk file "${path}"`);
  }

  async delete(path: string): Promise<void> {
    const response = await this.api(`https://cloud-api.yandex.net/v1/disk/resources?${new URLSearchParams({ path: this.remotePath(path), permanently: "true" })}`, "DELETE");
    if (response.status !== 404) assertSuccess(response.status, `Could not delete Yandex Disk file "${path}"`);
  }
}

interface PCloudEntry {
  name: string;
  isfolder?: boolean;
  modified?: string;
  size?: number;
  fileid?: number;
  folderid?: number;
  contents?: PCloudEntry[];
}

interface PCloudResponse {
  result: number;
  error?: string;
  metadata?: PCloudEntry;
  contents?: PCloudEntry[];
  hosts?: string[];
  path?: string;
}

export class PCloudProvider implements CloudProvider {
  private readonly settings: PluginSettings;
  private readonly apiHost: string;
  private readonly root: string;
  private readonly fileIds = new Map<string, number>();

  constructor(settings: PluginSettings) {
    if (!settings.pcloudToken.trim()) throw new Error("Enter a pCloud OAuth token in plugin settings.");
    this.settings = settings;
    this.apiHost = settings.pcloudRegion === "eu" ? "https://eapi.pcloud.com" : "https://api.pcloud.com";
    this.root = cleanPath(settings.remoteFolder);
  }

  private async api(method: string, params: Record<string, string> = {}) {
    const query = new URLSearchParams({ ...params, access_token: this.settings.pcloudToken.trim() });
    const response = await requestUrl({ url: `${this.apiHost}/${method}?${query}`, method: "GET", throw: false });
    const data = response.json as PCloudResponse;
    if (response.status < 200 || response.status >= 300 || data.result !== 0) throw new Error(`pCloud ${method} failed: ${data.error ?? `result ${data.result}`}`);
    return data;
  }

  private path(path: string): string {
    return `/${[this.root, cleanPath(path)].filter(Boolean).join("/")}`;
  }

  private flatten(items: PCloudEntry[], parent: string, output: FileEntry[]): void {
    for (const item of items) {
      const path = cleanPath(parent ? `${parent}/${item.name}` : item.name);
      if (item.isfolder) this.flatten(item.contents ?? [], path, output);
      else {
        if (item.fileid) this.fileIds.set(path, item.fileid);
        output.push({ path, mtime: item.modified ? Date.parse(item.modified) || 0 : 0, size: item.size ?? 0, isFolder: false });
      }
    }
  }

  async list(): Promise<FileEntry[]> {
    this.fileIds.clear();
    const response = await this.api("listfolder", { path: this.root ? `/${this.root}` : "/", recursive: "1" });
    const output: FileEntry[] = [];
    this.flatten(response.metadata?.contents ?? response.contents ?? [], "", output);
    return output;
  }

  async read(path: string): Promise<ArrayBuffer> {
    let fileId = this.fileIds.get(cleanPath(path));
    if (!fileId) {
      const stat = await this.api("stat", { path: this.path(path) });
      fileId = stat.metadata?.fileid;
    }
    if (!fileId) throw new Error(`pCloud file not found: ${path}`);
    const link = await this.api("getfilelink", { fileid: String(fileId) });
    if (!link.hosts?.length || !link.path) throw new Error(`pCloud did not return a download link for "${path}".`);
    const response = await requestUrl({ url: `https://${link.hosts[0]}${link.path}`, method: "GET", throw: false });
    assertSuccess(response.status, `Could not download pCloud file "${path}"`);
    return response.arrayBuffer;
  }

  private async ensureFolder(path: string): Promise<number> {
    if (!cleanPath(path)) return 0;
    const params = new URLSearchParams({ path: path ? `/${path}` : "/", access_token: this.settings.pcloudToken.trim() });
    const response = await requestUrl({ url: `${this.apiHost}/createfolderifnotexists?${params}`, method: "GET", throw: false });
    const data = response.json as PCloudResponse;
    if (response.status < 200 || response.status >= 300 || data.result !== 0 || !data.metadata?.folderid) throw new Error(`Could not create pCloud folder "${path}": ${data.error ?? data.result}`);
    return data.metadata.folderid;
  }

  async write(path: string, data: ArrayBuffer, mtime: number): Promise<void> {
    const parent = cleanPath(path).split("/").slice(0, -1).join("/");
    const folderId = await this.ensureFolder([this.root, parent].filter(Boolean).join("/"));
    const filename = cleanPath(path).split("/").pop()!;
    const boundary = `my-cloud-sync-${crypto.randomUUID()}`;
    const query = new URLSearchParams({ folderid: String(folderId), filename, mtime: String(Math.floor(mtime / 1000)), nopartial: "1", access_token: this.settings.pcloudToken.trim() });
    const prefix = encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename.replace(/["\\\r\n]/g, "_")}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
    const body = concatenate([prefix, new Uint8Array(data), suffix]);
    const response = await requestUrl({ url: `${this.apiHost}/uploadfile?${query}`, method: "POST", body, headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, throw: false });
    const result = response.json as PCloudResponse;
    if (response.status < 200 || response.status >= 300 || result.result !== 0) throw new Error(`pCloud upload failed: ${result.error ?? `result ${result.result}`}`);
  }

  async delete(path: string): Promise<void> {
    const fileId = this.fileIds.get(cleanPath(path));
    const params: Record<string, string> = fileId ? { fileid: String(fileId) } : { path: this.path(path) };
    await this.api("deletefile", params);
  }
}

export class WebdisProvider implements CloudProvider {
  private readonly baseUrl: URL;
  private readonly prefix: string;
  private readonly headers: Record<string, string>;

  constructor(settings: PluginSettings) {
    if (!settings.webdisUrl.trim()) throw new Error("Enter the Webdis server URL in plugin settings.");
    this.baseUrl = new URL(settings.webdisUrl.trim());
    if (this.baseUrl.protocol !== "https:" && !(this.baseUrl.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(this.baseUrl.hostname))) throw new Error("Webdis must use HTTPS (HTTP is allowed only on localhost).");
    if (this.baseUrl.username || this.baseUrl.password || this.baseUrl.hash) throw new Error("Enter Webdis credentials in their settings fields, not in the URL.");
    this.baseUrl.pathname = `${this.baseUrl.pathname.replace(/\/+$/, "")}/`;
    this.prefix = `my-cloud-sync:${encodeURIComponent(cleanPath(settings.remoteFolder))}/`;
    this.headers = {};
    if (settings.webdisUsername || settings.webdisPassword) this.headers.Authorization = encodeBasicAuth(settings.webdisUsername, settings.webdisPassword);
  }

  private key(path: string, metadata = false): string {
    return `${this.prefix}${metadata ? "m:" : "f:"}${encodeURIComponent(cleanPath(path))}`;
  }

  private commandUrl(command: string, key: string, raw = false): string {
    const suffix = raw ? ".raw" : ".json";
    return new URL(`${command}/${encodeURIComponent(key)}${suffix}`, this.baseUrl).toString();
  }

  private async request(url: string, method = "GET", body?: ArrayBuffer) {
    return requestUrl({ url, method, body, headers: this.headers, throw: false });
  }

  async list(): Promise<FileEntry[]> {
    const output: FileEntry[] = [];
    let cursor = "0";
    do {
      const scanUrl = new URL(`SCAN/${encodeURIComponent(cursor)}/MATCH/${encodeURIComponent(`${this.prefix}f:*`)}/COUNT/1000.json`, this.baseUrl);
      const response = await requestUrl({ url: scanUrl.toString(), headers: this.headers, throw: false });
      assertSuccess(response.status, "Could not scan Webdis keys");
      const scan = response.json as { SCAN?: [string, string[]] };
      const [next, keys] = scan.SCAN ?? ["0", []];
      cursor = next;
      for (const key of keys) {
        if (!key.startsWith(`${this.prefix}f:`)) continue;
        const encodedPath = key.slice(`${this.prefix}f:`.length);
        let path: string;
        try { path = decodeURIComponent(encodedPath); } catch { continue; }
        if (!path || path.split("/").some((part) => part === "." || part === "..")) continue;
        const meta = await this.request(this.commandUrl("GET", this.key(path, true), true));
        const [mtimeValue, sizeValue] = meta.status === 404 ? ["0", "0"] : meta.text.split(":");
        output.push({ path, mtime: Number(mtimeValue) || 0, size: Number(sizeValue) || 0, isFolder: false });
      }
    } while (cursor !== "0");
    return output;
  }

  async read(path: string): Promise<ArrayBuffer> {
    const response = await this.request(this.commandUrl("GET", this.key(path), true));
    assertSuccess(response.status, `Could not read Webdis key for "${path}"`);
    return response.arrayBuffer;
  }

  async write(path: string, data: ArrayBuffer, mtime: number): Promise<void> {
    const content = await this.request(this.commandUrl("SET", this.key(path)), "PUT", data);
    assertSuccess(content.status, `Could not write Webdis key for "${path}"`);
    const stamp = encoder.encode(`${mtime}:${data.byteLength}`);
    const metadata = await this.request(this.commandUrl("SET", this.key(path, true)), "PUT", toArrayBuffer(stamp));
    assertSuccess(metadata.status, `Could not update Webdis timestamp for "${path}"`);
  }

  async delete(path: string): Promise<void> {
    const keys = [this.key(path), this.key(path, true)];
    const url = new URL(`DEL/${keys.map(encodeURIComponent).join("/")}.json`, this.baseUrl);
    const response = await this.request(url.toString());
    assertSuccess(response.status, `Could not delete Webdis keys for "${path}"`);
  }
}

interface BoxItem {
  id: string;
  name: string;
  type: "file" | "folder";
  size?: number;
  modified_at?: string;
}

interface BoxPage {
  entries?: BoxItem[];
  total_count?: number;
}

export class BoxProvider implements CloudProvider {
  private readonly settings: PluginSettings;
  private readonly rootPath: string;
  private rootId = "";
  private readonly fileIds = new Map<string, string>();

  constructor(settings: PluginSettings) {
    if (!settings.boxClientId.trim() || !settings.boxClientSecret || !settings.boxRefreshToken) throw new Error("Set Box OAuth credentials and connect your account in plugin settings.");
    this.settings = settings;
    this.rootPath = cleanPath(settings.remoteFolder);
  }

  private async accessToken(): Promise<string> {
    if (this.settings.boxAccessToken && Date.now() < this.settings.boxAccessTokenExpiresAt - 60_000) return this.settings.boxAccessToken;
    const response = await requestUrl({
      url: "https://api.box.com/oauth2/token",
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        client_id: this.settings.boxClientId.trim(),
        client_secret: this.settings.boxClientSecret,
        grant_type: "refresh_token",
        refresh_token: this.settings.boxRefreshToken,
      }).toString(),
      throw: false,
    });
    const data = response.json as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
    if (response.status < 200 || response.status >= 300 || !data.access_token || !data.refresh_token) throw new Error(`Box token refresh failed: ${data.error_description ?? response.status}`);
    this.settings.boxAccessToken = data.access_token;
    this.settings.boxRefreshToken = data.refresh_token;
    this.settings.boxAccessTokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    return data.access_token;
  }

  private async api(url: string, method = "GET", body?: string | ArrayBuffer, contentType?: string) {
    const response = await requestUrl({
      url: url.startsWith("http") ? url : `https://api.box.com/2.0${url}`,
      method,
      body,
      headers: { Authorization: `Bearer ${await this.accessToken()}` },
      contentType,
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`Box request failed (HTTP ${response.status}): ${response.text.slice(0, 250)}`);
    return response;
  }

  private async children(folderId: string): Promise<BoxItem[]> {
    const items: BoxItem[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    while (offset < total) {
      const params = new URLSearchParams({ limit: "1000", offset: String(offset), fields: "id,name,type,size,modified_at" });
      const page = (await this.api(`/folders/${encodeURIComponent(folderId)}/items?${params}`)).json as BoxPage;
      const entries = page.entries ?? [];
      items.push(...entries);
      total = page.total_count ?? entries.length;
      offset += entries.length;
      if (!entries.length) break;
    }
    return items;
  }

  private async ensureFolder(parentId: string, name: string): Promise<string> {
    const existing = (await this.children(parentId)).filter((item) => item.type === "folder" && item.name === name);
    if (existing.length > 1) throw new Error(`Box has duplicate folders named "${name}".`);
    if (existing.length) return existing[0].id;
    const response = await this.api("/folders", "POST", JSON.stringify({ name, parent: { id: parentId } }), "application/json");
    return (response.json as BoxItem).id;
  }

  private async rootFolder(): Promise<string> {
    if (this.rootId) return this.rootId;
    let parent = "0";
    for (const segment of this.rootPath.split("/").filter(Boolean)) parent = await this.ensureFolder(parent, segment);
    this.rootId = parent;
    return parent;
  }

  async list(): Promise<FileEntry[]> {
    this.fileIds.clear();
    const output: FileEntry[] = [];
    const queue: Array<{ id: string; path: string }> = [{ id: await this.rootFolder(), path: "" }];
    while (queue.length) {
      const folder = queue.shift()!;
      for (const item of await this.children(folder.id)) {
        const path = cleanPath(folder.path ? `${folder.path}/${item.name}` : item.name);
        if (item.type === "folder") queue.push({ id: item.id, path });
        else if (item.type === "file") {
          this.fileIds.set(path, item.id);
          output.push({ path, mtime: item.modified_at ? Date.parse(item.modified_at) || 0 : 0, size: item.size ?? 0, isFolder: false });
        }
      }
    }
    return output;
  }

  async read(path: string): Promise<ArrayBuffer> {
    const id = this.fileIds.get(cleanPath(path));
    if (!id) throw new Error(`Box file not found: ${path}`);
    const response = await this.api(`/files/${encodeURIComponent(id)}/content`);
    return response.arrayBuffer;
  }

  async write(path: string, data: ArrayBuffer): Promise<void> {
    const parts = cleanPath(path).split("/");
    let parentId = await this.rootFolder();
    for (const segment of parts.slice(0, -1)) parentId = await this.ensureFolder(parentId, segment);
    const filename = parts[parts.length - 1];
    const existing = (await this.children(parentId)).filter((item) => item.type === "file" && item.name === filename);
    if (existing.length > 1) throw new Error(`Box has duplicate files named "${path}".`);
    const boundary = `my-cloud-sync-${crypto.randomUUID()}`;
    const attributes = existing.length ? { name: filename } : { name: filename, parent: { id: parentId } };
    const prefix = encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="attributes"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(attributes)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename.replace(/["\\\r\n]/g, "_")}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
    const body = concatenate([prefix, new Uint8Array(data), suffix]);
    const url = existing.length
      ? `https://upload.box.com/api/2.0/files/${encodeURIComponent(existing[0].id)}/content`
      : "https://upload.box.com/api/2.0/files/content";
    const response = await this.api(url, "POST", body, `multipart/form-data; boundary=${boundary}`);
    if (response.status !== 201 && response.status !== 202) assertSuccess(response.status, `Could not upload Box file "${path}"`);
  }

  async delete(path: string): Promise<void> {
    const id = this.fileIds.get(cleanPath(path));
    if (!id) return;
    await this.api(`/files/${encodeURIComponent(id)}`, "DELETE");
  }
}

export async function connectBox(settings: PluginSettings): Promise<void> {
  if (Platform.isMobile) throw new Error("Box sign-in needs a local browser callback and must be connected on desktop. After connecting there, securely transfer the plugin settings to this device.");
  if (!settings.boxClientId.trim() || !settings.boxClientSecret) throw new Error("Enter the Box client ID and client secret first.");
  const redirect = new URL(settings.boxRedirectUri);
  if (redirect.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(redirect.hostname) || !redirect.port) throw new Error("Box redirect URI must be a localhost URL with an explicit port, for example http://localhost:53682/callback.");
  const http = await import("http");
  const state = Array.from(crypto.getRandomValues(new Uint8Array(24))).map((value) => value.toString(16).padStart(2, "0")).join("");
  const callback = new Promise<string>((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const callbackUrl = new URL(request.url ?? "/", settings.boxRedirectUri);
      if (callbackUrl.pathname !== redirect.pathname) { response.writeHead(404).end("Not found."); return; }
      if (callbackUrl.searchParams.get("state") !== state) { response.writeHead(400).end("OAuth state mismatch."); window.clearTimeout(timeout); server.close(); reject(new Error("Box sign-in state did not match.")); return; }
      const error = callbackUrl.searchParams.get("error");
      if (error) { response.writeHead(400).end("Box sign-in was cancelled."); window.clearTimeout(timeout); server.close(); reject(new Error(`Box sign-in failed: ${error}`)); return; }
      const code = callbackUrl.searchParams.get("code");
      if (!code) { response.writeHead(400).end("Box did not return an authorization code."); window.clearTimeout(timeout); server.close(); reject(new Error("Box did not return an authorization code.")); return; }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("<p>Box connected. Return to Obsidian.</p>");
      window.clearTimeout(timeout); server.close(); resolve(code);
    });
    const timeout = window.setTimeout(() => { server.close(); reject(new Error("Box sign-in timed out.")); }, 5 * 60_000);
    server.once("error", (error) => { window.clearTimeout(timeout); reject(new Error(`Could not open the Box callback listener: ${error.message}`)); });
    server.listen(Number(redirect.port), redirect.hostname, () => {
      const auth = new URL("https://account.box.com/api/oauth2/authorize");
      auth.search = new URLSearchParams({ response_type: "code", client_id: settings.boxClientId.trim(), redirect_uri: settings.boxRedirectUri, state }).toString();
      window.open(auth.toString());
    });
  });
  const code = await callback;
  const response = await requestUrl({
    url: "https://api.box.com/oauth2/token",
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: settings.boxClientId.trim(), client_secret: settings.boxClientSecret, redirect_uri: settings.boxRedirectUri }).toString(),
    throw: false,
  });
  const data = response.json as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (response.status < 200 || response.status >= 300 || !data.access_token || !data.refresh_token) throw new Error(`Box connection failed: ${data.error_description ?? response.status}`);
  settings.boxAccessToken = data.access_token;
  settings.boxRefreshToken = data.refresh_token;
  settings.boxAccessTokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
}

export function createProvider(settings: PluginSettings): CloudProvider {
  switch (settings.provider) {
    case "google-drive":
      return new GoogleDriveProvider(settings);
    case "webdav":
      return new WebDavProvider(settings);
    case "s3":
      return new S3Provider(settings);
    case "azure-blob":
      return new AzureBlobProvider(settings);
    case "dropbox":
      return new DropboxProvider(settings);
    case "onedrive":
      return new OneDriveProvider(settings);
    case "yandex-disk":
      return new YandexDiskProvider(settings);
    case "pcloud":
      return new PCloudProvider(settings);
    case "webdis":
      return new WebdisProvider(settings);
    case "box":
      return new BoxProvider(settings);
    default:
      throw new Error(`Unsupported cloud provider: ${settings.provider}`);
  }
}

export async function connectGoogleDrive(settings: PluginSettings): Promise<void> {
  if (Platform.isMobile) throw new Error("Google's current desktop OAuth callback cannot be opened by Obsidian Mobile. Connect Google Drive on desktop, then securely transfer the plugin settings to this device.");
  if (!settings.googleClientId.trim()) {
    throw new Error("Enter a Google OAuth desktop client ID before connecting.");
  }

  const http = await import("http");
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const challengeBytes = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const state = Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

  const callbackCode = new Promise<{ code: string; redirectUri: string }>(
    (resolve, reject) => {
      let settled = false;
      const server = http.createServer((request, response) => {
        const address = server.address();
        if (!address || typeof address === "string") {
          response.writeHead(500).end("OAuth callback server error.");
          return;
        }
        const redirectUri = `http://127.0.0.1:${address.port}`;
        const callback = new URL(request.url ?? "/", redirectUri);
        if (callback.pathname !== "/") {
          response.writeHead(404).end("Not found.");
          return;
        }
        if (callback.searchParams.get("state") !== state) {
          response.writeHead(400).end("OAuth state did not match.");
          return;
        }
        const oauthError = callback.searchParams.get("error");
        if (oauthError) {
          response.writeHead(400).end("Google sign-in was cancelled or denied.");
          settled = true;
          window.clearTimeout(timeout);
          server.close();
          reject(new Error(`Google sign-in was not completed: ${oauthError}`));
          return;
        }
        const code = callback.searchParams.get("code");
        if (!code) {
          response.writeHead(400).end("Google did not return an authorization code.");
          return;
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<p>Google Drive connected. You can close this tab and return to Obsidian.</p>");
        settled = true;
        window.clearTimeout(timeout);
        server.close();
        resolve({ code, redirectUri });
      });
      const timeout = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          server.close();
          reject(new Error("Google sign-in timed out. Please try again."));
        }
      }, 5 * 60 * 1000);
      server.once("error", (error) => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(error);
        }
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          window.clearTimeout(timeout);
          server.close();
          reject(new Error("Could not start the local Google sign-in callback."));
          return;
        }
        const redirectUri = `http://127.0.0.1:${address.port}`;
        const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authUrl.search = new URLSearchParams({
          client_id: settings.googleClientId.trim(),
          redirect_uri: redirectUri,
          response_type: "code",
          scope: "https://www.googleapis.com/auth/drive",
          access_type: "offline",
          prompt: "consent",
          code_challenge: challenge,
          code_challenge_method: "S256",
          state,
        }).toString();
        window.open(authUrl.toString());
      });
    }
  );

  const { code, redirectUri } = await callbackCode;
  const response = await requestUrl({
    url: "https://oauth2.googleapis.com/token",
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams({
      client_id: settings.googleClientId.trim(),
      ...(settings.googleClientSecret.trim() ? { client_secret: settings.googleClientSecret.trim() } : {}),
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }).toString(),
    throw: false,
  });
  const tokens = response.json as TokenResponse;
  if (response.status < 200 || response.status >= 300 || !tokens.refresh_token) {
    const detail = tokens.error_description || tokens.error || response.status;
    const secretHint = String(detail).toLowerCase().includes("client_secret")
      ? " Add the client secret shown for this OAuth client in Google Cloud Console, then try again."
      : " Ensure the OAuth client is a Desktop app.";
    throw new Error(`Google sign-in failed: ${detail}.${secretHint}`);
  }
  settings.googleRefreshToken = tokens.refresh_token;
  settings.googleAccessToken = tokens.access_token ?? "";
  settings.googleAccessTokenExpiresAt =
    Date.now() + (tokens.expires_in ?? 3600) * 1000;
}
