"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all2) => {
  for (var name in all2)
    __defProp(target, name, { get: all2[name], enumerable: true });
};
var __copyProps = (to, from2, except, desc) => {
  if (from2 && typeof from2 === "object" || typeof from2 === "function") {
    for (let key of __getOwnPropNames(from2))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from2[key], enumerable: !(desc = __getOwnPropDesc(from2, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => MyCloudSyncPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");

// src/providers.ts
var import_obsidian = require("obsidian");
var DRIVE_API = "https://www.googleapis.com/drive/v3";
var DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
var DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
var encoder = new TextEncoder();
function toArrayBuffer(bytes) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
function cleanPath(path) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error(`Invalid cloud path: ${path}`);
  }
  return parts.join("/");
}
function encodePath(path) {
  return cleanPath(path).split("/").map(encodeURIComponent).join("/");
}
function assertSuccess(status, message) {
  if (status < 200 || status >= 300) {
    throw new Error(`${message} (HTTP ${status})`);
  }
}
function encodeBasicAuth(username, password) {
  const bytes = encoder.encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `Basic ${btoa(binary)}`;
}
function findDescendant(element2, localName) {
  for (const child of Array.from(element2.getElementsByTagName("*"))) {
    if (child.localName === localName) {
      return child;
    }
  }
  return null;
}
var WebDavProvider = class {
  constructor(settings) {
    if (!settings.webdavUrl.trim()) {
      throw new Error("Enter a WebDAV server URL in plugin settings.");
    }
    this.baseUrl = new URL(settings.webdavUrl);
    if (this.baseUrl.protocol !== "https:" && !(this.baseUrl.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(this.baseUrl.hostname))) {
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
  url(path) {
    const encoded = encodePath(path);
    return new URL(encoded, this.rootUrl).toString();
  }
  async request(url, method, body, headers = {}) {
    return (0, import_obsidian.requestUrl)({
      url,
      method,
      body,
      headers: { ...this.headers, ...headers },
      throw: false
    });
  }
  async ensureFolder(path) {
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
  async ensureRootFolder() {
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
  async list() {
    await this.ensureRootFolder();
    const entries = [];
    const folders = [""];
    const visited = /* @__PURE__ */ new Set();
    while (folders.length > 0) {
      const folder = folders.shift();
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
      const document2 = new DOMParser().parseFromString(response.text, "application/xml");
      if (document2.getElementsByTagName("parsererror").length > 0) {
        throw new Error("The WebDAV server returned invalid XML.");
      }
      const responses = Array.from(document2.getElementsByTagName("*")).filter(
        (element2) => element2.localName === "response"
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
          (element2) => element2.localName === "collection"
        );
        const modified = findDescendant(item, "getlastmodified")?.textContent;
        const size2 = findDescendant(item, "getcontentlength")?.textContent;
        if (isFolder) {
          folders.push(path);
        } else {
          entries.push({
            path,
            mtime: modified ? Date.parse(modified) || 0 : 0,
            size: size2 ? Number.parseInt(size2, 10) || 0 : 0,
            isFolder: false
          });
        }
      }
    }
    return entries;
  }
  async read(path) {
    const response = await this.request(this.url(path), "GET");
    assertSuccess(response.status, `Could not download "${path}" from WebDAV`);
    return response.arrayBuffer;
  }
  async write(path, data) {
    const clean = cleanPath(path);
    const parent = clean.split("/").slice(0, -1).join("/");
    if (parent) {
      await this.ensureFolder(parent);
    }
    const response = await this.request(this.url(clean), "PUT", data, {
      "Content-Type": "application/octet-stream"
    });
    assertSuccess(response.status, `Could not upload "${path}" to WebDAV`);
  }
  async delete(path) {
    const response = await this.request(this.url(path), "DELETE");
    if (response.status !== 404) assertSuccess(response.status, `Could not delete "${path}" from WebDAV`);
  }
};
function escapeDriveQuery(value) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
function concatenate(parts) {
  const length2 = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length2);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result.buffer;
}
var GoogleDriveProvider = class {
  constructor(settings) {
    this.folderIds = /* @__PURE__ */ new Map();
    this.rootFolderId = "";
    this.settings = settings;
    if (!settings.googleClientId.trim()) {
      throw new Error("Enter a Google OAuth desktop client ID in plugin settings.");
    }
    if (!settings.googleRefreshToken) {
      throw new Error("Connect a Google account in plugin settings first.");
    }
  }
  async accessToken() {
    if (this.settings.googleAccessToken && Date.now() < this.settings.googleAccessTokenExpiresAt - 6e4) {
      return this.settings.googleAccessToken;
    }
    const response = await (0, import_obsidian.requestUrl)({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        client_id: this.settings.googleClientId,
        ...this.settings.googleClientSecret.trim() ? { client_secret: this.settings.googleClientSecret.trim() } : {},
        grant_type: "refresh_token",
        refresh_token: this.settings.googleRefreshToken
      }).toString(),
      throw: false
    });
    const tokens = response.json;
    if (response.status < 200 || response.status >= 300 || !tokens.access_token) {
      throw new Error(
        `Google token refresh failed: ${tokens.error_description || tokens.error || response.status}`
      );
    }
    this.settings.googleAccessToken = tokens.access_token;
    this.settings.googleAccessTokenExpiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1e3;
    return tokens.access_token;
  }
  async api(url, method = "GET", body, contentType) {
    const token = await this.accessToken();
    const response = await (0, import_obsidian.requestUrl)({
      url,
      method,
      body,
      headers: { Authorization: `Bearer ${token}` },
      contentType,
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      const detail = response.text.slice(0, 300);
      throw new Error(`Google Drive request failed (HTTP ${response.status}): ${detail}`);
    }
    return response;
  }
  async filesInFolder(parentId, name) {
    const clauses = [`'${escapeDriveQuery(parentId)}' in parents`, "trashed = false"];
    if (name !== void 0) {
      clauses.push(`name = '${escapeDriveQuery(name)}'`);
    }
    const found = [];
    let pageToken = "";
    do {
      const params2 = new URLSearchParams({
        q: clauses.join(" and "),
        pageSize: "1000",
        fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size)",
        spaces: "drive"
      });
      if (pageToken) {
        params2.set("pageToken", pageToken);
      }
      const response = await this.api(`${DRIVE_API}/files?${params2.toString()}`);
      const page = response.json;
      found.push(...page.files ?? []);
      pageToken = page.nextPageToken ?? "";
    } while (pageToken);
    return found;
  }
  async findOrCreateFolder(parentId, name) {
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
    return response.json.id;
  }
  async ensureRootFolder() {
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
  async list() {
    const rootId = await this.ensureRootFolder();
    const entries = [];
    const queue = [{ id: rootId, path: "" }];
    while (queue.length) {
      const folder = queue.shift();
      const children = await this.filesInFolder(folder.id);
      const pathsSeen = /* @__PURE__ */ new Set();
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
            isFolder: false
          });
        }
      }
    }
    return entries;
  }
  async read(path) {
    const file = (await this.findItem(path)).file;
    if (!file) {
      throw new Error(`Google Drive file not found: ${path}`);
    }
    const response = await this.api(`${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`);
    return response.arrayBuffer;
  }
  async findItem(path) {
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
        if (folders.length === 0) return { file: void 0, parentId };
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
  async write(path, data, mtime) {
    const clean = cleanPath(path);
    const parts = clean.split("/");
    let parentId = await this.ensureRootFolder();
    let parentPath = "";
    for (const segment of parts.slice(0, -1)) {
      parentPath = parentPath ? `${parentPath}/${segment}` : segment;
      let id2 = this.folderIds.get(parentPath);
      if (!id2) {
        id2 = await this.findOrCreateFolder(parentId, segment);
        this.folderIds.set(parentPath, id2);
      }
      parentId = id2;
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
      ...existing.length ? {} : { parents: [parentId] },
      modifiedTime: new Date(mtime).toISOString()
    });
    const prefix = encoder.encode(
      `--${boundary}\r
Content-Type: application/json; charset=UTF-8\r
\r
${metadata}\r
--${boundary}\r
Content-Type: application/octet-stream\r
\r
`
    );
    const suffix = encoder.encode(`\r
--${boundary}--`);
    const method = existing.length ? "PATCH" : "POST";
    const url = existing.length ? `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(existing[0].id)}?uploadType=multipart` : `${DRIVE_UPLOAD_API}/files?uploadType=multipart`;
    await this.api(url, method, concatenate([prefix, new Uint8Array(data), suffix]), `multipart/related; boundary=${boundary}`);
  }
  async delete(path) {
    const { file } = await this.findItem(path);
    if (file) await this.api(`${DRIVE_API}/files/${encodeURIComponent(file.id)}`, "DELETE");
  }
};
var S3Provider = class {
  constructor(settings) {
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
    this.endpoint = settings.s3Endpoint.trim() ? new URL(settings.s3Endpoint) : void 0;
    this.accessKey = settings.s3AccessKey.trim();
    this.secretKey = settings.s3SecretKey;
  }
  key(path) {
    const relative = cleanPath(path);
    return [this.prefix, relative].filter(Boolean).join("/");
  }
  async signedRequest(method, key = "", query = {}, body) {
    const url = this.endpoint ? new URL(this.endpoint.toString()) : new URL(`https://${this.bucket}.s3.${this.region}.amazonaws.com`);
    const basePath = url.pathname.replace(/\/+$/, "");
    const pathStyle = !!this.endpoint || this.bucket.includes(".");
    if (!this.endpoint && pathStyle) url.hostname = `s3.${this.region}.amazonaws.com`;
    const objectPath = [pathStyle ? this.bucket : "", key].filter(Boolean).join("/");
    url.pathname = `${basePath}${objectPath ? `/${objectPath.split("/").map(awsEncode).join("/")}` : "/"}`;
    const queryParts = Object.entries(query).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${awsEncode(name)}=${awsEncode(value)}`);
    url.search = queryParts.join("&");
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
    const day = timestamp.slice(0, 8);
    const payload = body ? new Uint8Array(body) : new Uint8Array();
    const payloadHash = await sha256Hex(payload);
    const headers = {
      "x-amz-date": timestamp,
      "x-amz-content-sha256": payloadHash
    };
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalHeaders = `host:${url.host.toLowerCase()}
x-amz-content-sha256:${payloadHash}
x-amz-date:${timestamp}
`;
    const canonicalRequest = [method, url.pathname, url.search.slice(1), canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${day}/${this.region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256
${timestamp}
${scope}
${await sha256Hex(encoder.encode(canonicalRequest))}`;
    const dateKey = await hmacSha256(encoder.encode(`AWS4${this.secretKey}`), day);
    const regionKey = await hmacSha256(dateKey, this.region);
    const serviceKey = await hmacSha256(regionKey, "s3");
    const signingKey = await hmacSha256(serviceKey, "aws4_request");
    const signature2 = toHex(new Uint8Array(await hmacSha256(signingKey, stringToSign)));
    headers.Authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature2}`;
    if (method === "PUT") headers["Content-Type"] = "application/octet-stream";
    const response = await (0, import_obsidian.requestUrl)({ url: url.toString(), method, headers, body, throw: false });
    return response;
  }
  async list() {
    const result = [];
    let token;
    const prefix = this.prefix ? `${this.prefix}/` : "";
    do {
      const query = { "list-type": "2", prefix };
      if (token) query["continuation-token"] = token;
      const page = await this.signedRequest("GET", "", query);
      assertSuccess(page.status, "Could not list S3 bucket");
      const document2 = new DOMParser().parseFromString(page.text, "application/xml");
      if (document2.getElementsByTagName("parsererror").length) throw new Error("S3 returned invalid listing XML.");
      for (const item of Array.from(document2.getElementsByTagName("Contents"))) {
        const key = findDescendant(item, "Key")?.textContent ?? "";
        if (!key || key.endsWith("/")) continue;
        const path = this.prefix ? key.slice(prefix.length) : key;
        if (!path || path.startsWith("/") || path.split("/").some((part) => part === ".." || part === ".")) continue;
        const modified = findDescendant(item, "LastModified")?.textContent;
        const size2 = findDescendant(item, "Size")?.textContent;
        result.push({ path, mtime: modified ? Date.parse(modified) || 0 : 0, size: size2 ? Number.parseInt(size2, 10) || 0 : 0, isFolder: false });
      }
      const truncated = findDescendant(document2.documentElement, "IsTruncated")?.textContent === "true";
      token = truncated ? findDescendant(document2.documentElement, "NextContinuationToken")?.textContent ?? void 0 : void 0;
    } while (token);
    return result;
  }
  async read(path) {
    const response = await this.signedRequest("GET", this.key(path));
    assertSuccess(response.status, `Could not download S3 object "${path}"`);
    return response.arrayBuffer;
  }
  async write(path, data) {
    const response = await this.signedRequest("PUT", this.key(path), {}, data);
    assertSuccess(response.status, `Could not upload S3 object "${path}"`);
  }
  async delete(path) {
    const response = await this.signedRequest("DELETE", this.key(path));
    if (response.status !== 404) assertSuccess(response.status, `Could not delete S3 object "${path}"`);
  }
};
function awsEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}
function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function sha256Hex(value) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", value)));
}
async function hmacSha256(keyBytes, value) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, encoder.encode(value));
}
var AzureBlobProvider = class {
  constructor(settings) {
    if (!settings.azureSasUrl.trim()) throw new Error("Enter an Azure Blob container SAS URL.");
    this.containerUrl = new URL(settings.azureSasUrl.trim());
    if (this.containerUrl.protocol !== "https:") throw new Error("Azure Blob requires an HTTPS SAS URL.");
    if (this.containerUrl.username || this.containerUrl.password || this.containerUrl.hash) throw new Error("Azure SAS URL must not contain embedded credentials or a fragment.");
    if (!this.containerUrl.searchParams.has("sig")) throw new Error("The Azure URL must include a container SAS token with a sig parameter.");
    this.prefix = cleanPath(settings.remoteFolder);
  }
  url(path, query, includePrefix = true) {
    const key = [includePrefix ? this.prefix : "", cleanPath(path)].filter(Boolean).join("/");
    const base = new URL(this.containerUrl.toString());
    base.pathname = `${base.pathname.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
    for (const [name, value] of Object.entries(query ?? {})) base.searchParams.set(name, value);
    return base.toString();
  }
  async request(url, method, body, headers = {}) {
    return (0, import_obsidian.requestUrl)({ url, method, body, headers, throw: false });
  }
  async list() {
    const entries = [];
    let marker = "";
    const prefix = [this.prefix, ""].filter(Boolean).join("/");
    do {
      const query = { restype: "container", comp: "list", prefix: prefix ? `${prefix}/` : "" };
      if (marker) query.marker = marker;
      const response = await this.request(this.url("", query, false), "GET", void 0, { "x-ms-version": "2023-11-03" });
      assertSuccess(response.status, "Could not list Azure Blob container");
      const document2 = new DOMParser().parseFromString(response.text, "application/xml");
      if (document2.getElementsByTagName("parsererror").length) throw new Error("Azure returned invalid blob listing XML.");
      for (const blob of Array.from(document2.getElementsByTagName("Blob"))) {
        const name = blob.getElementsByTagName("Name")[0]?.textContent ?? "";
        if (!name.startsWith(prefix ? `${prefix}/` : "")) continue;
        const path = this.prefix ? name.slice(this.prefix.length + 1) : name;
        if (!path || path.split("/").some((part) => part === "." || part === "..")) continue;
        const properties = blob.getElementsByTagName("Properties")[0];
        const modified = properties?.getElementsByTagName("Last-Modified")[0]?.textContent;
        const size2 = properties?.getElementsByTagName("Content-Length")[0]?.textContent;
        entries.push({ path, mtime: modified ? Date.parse(modified) || 0 : 0, size: size2 ? Number.parseInt(size2, 10) || 0 : 0, isFolder: false });
      }
      marker = document2.getElementsByTagName("NextMarker")[0]?.textContent ?? "";
    } while (marker);
    return entries;
  }
  async read(path) {
    const response = await this.request(this.url(path), "GET", void 0, { "x-ms-version": "2023-11-03" });
    assertSuccess(response.status, `Could not download Azure blob "${path}"`);
    return response.arrayBuffer;
  }
  async write(path, data) {
    const response = await this.request(this.url(path), "PUT", data, {
      "x-ms-version": "2023-11-03",
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": "application/octet-stream"
    });
    assertSuccess(response.status, `Could not upload Azure blob "${path}"`);
  }
  async delete(path) {
    const response = await this.request(this.url(path), "DELETE", void 0, { "x-ms-version": "2023-11-03" });
    if (response.status !== 404) assertSuccess(response.status, `Could not delete Azure blob "${path}"`);
  }
};
var DropboxProvider = class {
  constructor(settings) {
    if (!settings.dropboxAppKey.trim() || !settings.dropboxRefreshToken) {
      throw new Error("Set the Dropbox app key and connect your account in plugin settings.");
    }
    this.settings = settings;
    this.root = cleanPath(settings.remoteFolder);
  }
  async accessToken() {
    if (this.settings.dropboxAccessToken && Date.now() < this.settings.dropboxAccessTokenExpiresAt - 6e4) return this.settings.dropboxAccessToken;
    const response = await (0, import_obsidian.requestUrl)({
      url: "https://api.dropbox.com/oauth2/token",
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        client_id: this.settings.dropboxAppKey.trim(),
        grant_type: "refresh_token",
        refresh_token: this.settings.dropboxRefreshToken
      }).toString(),
      throw: false
    });
    const data = response.json;
    if (response.status < 200 || response.status >= 300 || !data.access_token) throw new Error(`Dropbox token refresh failed: ${data.error_description ?? response.status}`);
    this.settings.dropboxAccessToken = data.access_token;
    this.settings.dropboxAccessTokenExpiresAt = Date.now() + (data.expires_in ?? 14400) * 1e3;
    return data.access_token;
  }
  async api(endpoint, arg, body, contentEndpoint = false, allowConflict = false) {
    const token = await this.accessToken();
    const response = await (0, import_obsidian.requestUrl)({
      url: `${contentEndpoint ? "https://content.dropboxapi.com" : "https://api.dropboxapi.com"}/2/${endpoint}`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Dropbox-API-Arg": JSON.stringify(arg),
        ...contentEndpoint ? { "Content-Type": "application/octet-stream" } : {}
      },
      contentType: contentEndpoint ? void 0 : "application/json",
      body,
      throw: false
    });
    if (allowConflict && response.status === 409) return response;
    if (response.status < 200 || response.status >= 300) throw new Error(`Dropbox ${endpoint} failed (HTTP ${response.status}): ${response.text.slice(0, 250)}`);
    return response;
  }
  path(path) {
    return `/${[this.root, cleanPath(path)].filter(Boolean).join("/")}`;
  }
  async ensureFolder(path) {
    let current = "";
    for (const segment of cleanPath(path).split("/").filter(Boolean)) {
      current = current ? `${current}/${segment}` : segment;
      await this.api("files/create_folder_v2", { path: `/${current}`, autorename: false }, void 0, false, true);
    }
  }
  async list() {
    await this.ensureFolder(this.root);
    const entries = [];
    let page = await this.api("files/list_folder", { path: this.root ? `/${this.root}` : "", recursive: true, include_deleted: false });
    let data = page.json;
    const addEntries = (items) => {
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
      data = page.json;
      addEntries(data.entries ?? []);
    }
    return entries;
  }
  async read(path) {
    return (await this.api("files/download", { path: this.path(path) }, void 0, true)).arrayBuffer;
  }
  async write(path, data, mtime) {
    const parent = cleanPath(path).split("/").slice(0, -1).join("/");
    await this.ensureFolder([this.root, parent].filter(Boolean).join("/"));
    await this.api("files/upload", {
      path: this.path(path),
      mode: "overwrite",
      autorename: false,
      mute: true,
      strict_conflict: true,
      client_modified: new Date(mtime).toISOString()
    }, data, true);
  }
  async delete(path) {
    await this.api("files/delete_v2", { path: this.path(path) });
  }
};
var AuthorizationCodeModal = class extends import_obsidian.Modal {
  constructor(app, provider, finish) {
    super(app);
    this.provider = provider;
    this.finish = finish;
    this.code = "";
    this.settled = false;
  }
  onOpen() {
    this.contentEl.createEl("h2", { text: `Connect ${this.provider}` });
    this.contentEl.createEl("p", { text: "Complete sign-in in the browser, copy the authorization code, then paste it here." });
    new import_obsidian.Setting(this.contentEl).setName("Authorization code").addText((text2) => {
      text2.setPlaceholder("Paste code").onChange((value) => {
        this.code = value.trim();
      });
    });
    new import_obsidian.Setting(this.contentEl).addButton((button) => button.setButtonText("Connect").setCta().onClick(() => {
      if (!this.code) {
        new import_obsidian.Notice("Paste the authorization code first.");
        return;
      }
      this.settled = true;
      this.finish(this.code);
      this.close();
    }));
  }
  onClose() {
    this.contentEl.empty();
    if (!this.settled) this.finish("");
  }
};
function requestDropboxCode(app, authUrl) {
  return new Promise((resolve) => {
    const modal = new AuthorizationCodeModal(app, "Dropbox", resolve);
    modal.open();
    window.open(authUrl);
  });
}
async function connectDropbox(settings, app) {
  if (!settings.dropboxAppKey.trim()) throw new Error("Enter a Dropbox app key before connecting.");
  const redirectUri = "http://localhost:53683/dropbox-callback";
  const http = import_obsidian.Platform.isDesktop ? await import("http") : void 0;
  const verifierBytes = crypto.getRandomValues(new Uint8Array(48));
  const verifier = btoa(String.fromCharCode(...verifierBytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const challengeBytes = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const authUrl = new URL("https://www.dropbox.com/oauth2/authorize");
  authUrl.search = new URLSearchParams({
    client_id: settings.dropboxAppKey.trim(),
    ...import_obsidian.Platform.isMobile ? {} : { redirect_uri: redirectUri },
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
    scope: "account_info.read files.metadata.read files.content.read files.content.write"
  }).toString();
  const state = Array.from(crypto.getRandomValues(new Uint8Array(24))).map((value) => value.toString(16).padStart(2, "0")).join("");
  if (!import_obsidian.Platform.isMobile) authUrl.searchParams.set("state", state);
  const code = import_obsidian.Platform.isMobile ? await requestDropboxCode(app, authUrl.toString()) : await new Promise((resolve, reject) => {
    if (!http) {
      reject(new Error("Local OAuth callback is unavailable."));
      return;
    }
    let settled = false;
    const server = http.createServer((request, response2) => {
      const callback = new URL(request.url ?? "/", redirectUri);
      if (callback.pathname !== "/dropbox-callback") {
        response2.writeHead(404).end("Not found.");
        return;
      }
      if (callback.searchParams.get("state") !== state) {
        response2.writeHead(400).end("Sign-in state mismatch.");
        return;
      }
      const error = callback.searchParams.get("error");
      const returnedCode = callback.searchParams.get("code");
      if (error || !returnedCode) {
        response2.writeHead(400).end("Dropbox sign-in was cancelled. Return to Obsidian.");
        settled = true;
        window.clearTimeout(timeout);
        server.close();
        reject(new Error(error ? `Dropbox sign-in failed: ${error}` : "Dropbox did not return an authorization code."));
        return;
      }
      response2.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("<p>Dropbox connected. Return to Obsidian.</p>");
      settled = true;
      window.clearTimeout(timeout);
      server.close();
      resolve(returnedCode);
    });
    const timeout = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
        reject(new Error("Dropbox sign-in timed out."));
      }
    }, 5 * 6e4);
    server.once("error", (error) => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timeout);
        reject(new Error(`Could not start Dropbox sign-in: ${error.message}`));
      }
    });
    server.listen(53683, "127.0.0.1", () => window.open(authUrl.toString()));
  });
  const response = await (0, import_obsidian.requestUrl)({
    url: "https://api.dropbox.com/oauth2/token",
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams({
      client_id: settings.dropboxAppKey.trim(),
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      ...!import_obsidian.Platform.isMobile ? { redirect_uri: redirectUri } : {}
    }).toString(),
    throw: false
  });
  const data = response.json;
  if (response.status < 200 || response.status >= 300 || !data.refresh_token || !data.access_token) {
    throw new Error(`Dropbox connection failed: ${data.error_description ?? response.status}`);
  }
  settings.dropboxRefreshToken = data.refresh_token;
  settings.dropboxAccessToken = data.access_token;
  settings.dropboxAccessTokenExpiresAt = Date.now() + (data.expires_in ?? 14400) * 1e3;
}
var OneDriveProvider = class {
  constructor(settings) {
    this.rootId = "";
    if (!settings.oneDriveClientId.trim() || !settings.oneDriveRefreshToken) throw new Error("Set the Microsoft client ID and connect OneDrive in plugin settings.");
    this.settings = settings;
  }
  async accessToken() {
    if (this.settings.oneDriveAccessToken && Date.now() < this.settings.oneDriveAccessTokenExpiresAt - 6e4) return this.settings.oneDriveAccessToken;
    const response = await (0, import_obsidian.requestUrl)({
      url: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        client_id: this.settings.oneDriveClientId.trim(),
        grant_type: "refresh_token",
        refresh_token: this.settings.oneDriveRefreshToken,
        scope: "Files.ReadWrite.AppFolder offline_access"
      }).toString(),
      throw: false
    });
    const data = response.json;
    if (response.status < 200 || response.status >= 300 || !data.access_token) throw new Error(`OneDrive token refresh failed: ${data.error_description ?? response.status}`);
    this.settings.oneDriveAccessToken = data.access_token;
    if (data.refresh_token) this.settings.oneDriveRefreshToken = data.refresh_token;
    this.settings.oneDriveAccessTokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1e3;
    return data.access_token;
  }
  async graph(url, method = "GET", body, contentType) {
    const response = await (0, import_obsidian.requestUrl)({
      url: url.startsWith("http") ? url : `https://graph.microsoft.com/v1.0${url}`,
      method,
      body,
      headers: { Authorization: `Bearer ${await this.accessToken()}` },
      contentType,
      throw: false
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`Microsoft Graph request failed (HTTP ${response.status}): ${response.text.slice(0, 250)}`);
    return response;
  }
  async children(parentId) {
    const items = [];
    let next = `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(parentId)}/children?$top=999`;
    do {
      const page = (await this.graph(next)).json;
      items.push(...page.value ?? []);
      next = page["@odata.nextLink"] ?? "";
    } while (next);
    return items;
  }
  async rootFolder() {
    if (this.rootId) return this.rootId;
    const driveRoot = this.settings.oneDriveFullAccess ? "/me/drive/root?$select=id" : "/me/drive/special/approot?$select=id";
    let parent = (await this.graph(driveRoot)).json.id;
    for (const segment of cleanPath(this.settings.remoteFolder).split("/").filter(Boolean)) {
      const existing = (await this.children(parent)).filter((item) => item.name === segment && !!item.folder);
      if (existing.length > 1) throw new Error(`OneDrive has duplicate folders named "${segment}".`);
      if (existing.length) parent = existing[0].id;
      else {
        const created = await this.graph(`/me/drive/items/${encodeURIComponent(parent)}/children`, "POST", JSON.stringify({ name: segment, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }), "application/json");
        parent = created.json.id;
      }
    }
    this.rootId = parent;
    return parent;
  }
  async list() {
    const output = [];
    const queue = [{ id: await this.rootFolder(), path: "" }];
    while (queue.length) {
      const folder = queue.shift();
      for (const item of await this.children(folder.id)) {
        const path = cleanPath(folder.path ? `${folder.path}/${item.name}` : item.name);
        if (item.folder) queue.push({ id: item.id, path });
        else if (item.file) output.push({ path, mtime: item.lastModifiedDateTime ? Date.parse(item.lastModifiedDateTime) || 0 : 0, size: item.size ?? 0, isFolder: false });
      }
    }
    return output;
  }
  async read(path) {
    const pathInDrive = cleanPath([this.settings.remoteFolder, path].filter(Boolean).join("/")).split("/").map(encodeURIComponent).join("/");
    const root = this.settings.oneDriveFullAccess ? "root" : "special/approot";
    const item = (await this.graph(`/me/drive/${root}:/${pathInDrive}?$select=id,@microsoft.graph.downloadUrl`)).json;
    if (!item["@microsoft.graph.downloadUrl"]) throw new Error(`OneDrive did not return a download URL for "${path}".`);
    return (await (0, import_obsidian.requestUrl)({ url: item["@microsoft.graph.downloadUrl"], method: "GET", throw: false })).arrayBuffer;
  }
  async write(path, data) {
    const parts = cleanPath(path).split("/");
    let parent = await this.rootFolder();
    for (const segment of parts.slice(0, -1)) {
      const matches = (await this.children(parent)).filter((item) => item.name === segment && !!item.folder);
      if (matches.length) parent = matches[0].id;
      else {
        const created = await this.graph(`/me/drive/items/${encodeURIComponent(parent)}/children`, "POST", JSON.stringify({ name: segment, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }), "application/json");
        parent = created.json.id;
      }
    }
    const filename = encodeURIComponent(parts[parts.length - 1]);
    await this.graph(`/me/drive/items/${encodeURIComponent(parent)}:/${filename}:/content`, "PUT", data, "application/octet-stream");
  }
  async delete(path) {
    const pathInDrive = cleanPath([this.settings.remoteFolder, path].filter(Boolean).join("/")).split("/").map(encodeURIComponent).join("/");
    const root = this.settings.oneDriveFullAccess ? "root" : "special/approot";
    const item = (await this.graph(`/me/drive/${root}:/${pathInDrive}?$select=id`)).json;
    await this.graph(`/me/drive/items/${encodeURIComponent(item.id)}`, "DELETE");
  }
};
var DeviceCodeModal = class extends import_obsidian.Modal {
  constructor(app, userCode, verificationUri) {
    super(app);
    this.userCode = userCode;
    this.verificationUri = verificationUri;
  }
  onOpen() {
    this.contentEl.createEl("h2", { text: "Connect OneDrive" });
    this.contentEl.createEl("p", { text: "Open Microsoft sign-in, enter this code, and approve access. Keep Obsidian open while it waits for confirmation." });
    this.contentEl.createEl("pre", { text: this.userCode, cls: "ocs-device-code" });
    new import_obsidian.Setting(this.contentEl).addButton((button) => button.setButtonText("Open Microsoft sign-in").setCta().onClick(() => window.open(this.verificationUri)));
    new import_obsidian.Setting(this.contentEl).addButton((button) => button.setButtonText("Close").onClick(() => this.close()));
  }
  onClose() {
    this.contentEl.empty();
  }
};
async function connectOneDriveMobile(settings, app) {
  const clientId = settings.oneDriveClientId.trim();
  const scope = `${settings.oneDriveFullAccess ? "Files.ReadWrite" : "Files.ReadWrite.AppFolder"} offline_access`;
  const deviceResponse = await (0, import_obsidian.requestUrl)({
    url: "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode",
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams({ client_id: clientId, scope }).toString(),
    throw: false
  });
  const device = deviceResponse.json;
  if (deviceResponse.status < 200 || deviceResponse.status >= 300 || !device.device_code || !device.user_code || !device.verification_uri) {
    throw new Error(device.error_description ?? device.error ?? `Microsoft device sign-in could not start (HTTP ${deviceResponse.status}). Confirm device code flow is enabled for a public client.`);
  }
  new DeviceCodeModal(app, device.user_code, device.verification_uri).open();
  const expiresAt = Date.now() + (device.expires_in ?? 900) * 1e3;
  let interval = Math.max(5, device.interval ?? 5);
  while (Date.now() < expiresAt) {
    await new Promise((resolve) => window.setTimeout(resolve, interval * 1e3));
    const response = await (0, import_obsidian.requestUrl)({
      url: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: clientId,
        device_code: device.device_code
      }).toString(),
      throw: false
    });
    const token = response.json;
    if (response.status >= 200 && response.status < 300 && token.access_token && token.refresh_token) {
      settings.oneDriveAccessToken = token.access_token;
      settings.oneDriveRefreshToken = token.refresh_token;
      settings.oneDriveAccessTokenExpiresAt = Date.now() + (token.expires_in ?? 3600) * 1e3;
      return;
    }
    if (token.error === "authorization_pending") continue;
    if (token.error === "slow_down") {
      interval += 5;
      continue;
    }
    throw new Error(token.error_description ?? token.error ?? `Microsoft sign-in failed (HTTP ${response.status}).`);
  }
  throw new Error("Microsoft sign-in code expired. Start the connection again.");
}
async function connectOneDrive(settings, app) {
  if (!settings.oneDriveClientId.trim()) throw new Error("Enter a Microsoft application client ID before connecting.");
  if (import_obsidian.Platform.isMobile) return connectOneDriveMobile(settings, app);
  const http = await import("http");
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(48))).map((value) => value.toString(16).padStart(2, "0")).join("");
  const challengeBytes = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const state = Array.from(crypto.getRandomValues(new Uint8Array(24))).map((value) => value.toString(16).padStart(2, "0")).join("");
  const callback = new Promise((resolve, reject) => {
    let settled = false;
    const server = http.createServer((request, response2) => {
      const address = server.address();
      if (!address || typeof address === "string") return;
      const redirectUri2 = `http://localhost:${address.port}`;
      const url = new URL(request.url ?? "/", redirectUri2);
      if (url.pathname !== "/") {
        response2.writeHead(404).end("Not found.");
        return;
      }
      if (url.searchParams.get("state") !== state) {
        response2.writeHead(400).end("OAuth state mismatch.");
        settled = true;
        window.clearTimeout(timeout);
        server.close();
        reject(new Error("Microsoft sign-in state did not match."));
        return;
      }
      const oauthError = url.searchParams.get("error");
      if (oauthError) {
        response2.writeHead(400).end("Microsoft sign-in was cancelled or denied.");
        settled = true;
        window.clearTimeout(timeout);
        server.close();
        reject(new Error(url.searchParams.get("error_description") ?? `Microsoft sign-in failed: ${oauthError}`));
        return;
      }
      const code2 = url.searchParams.get("code");
      if (!code2) {
        response2.writeHead(400).end("Microsoft did not return a code.");
        settled = true;
        window.clearTimeout(timeout);
        server.close();
        reject(new Error("Microsoft did not return an authorization code."));
        return;
      }
      response2.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("<p>OneDrive connected. Return to Obsidian.</p>");
      settled = true;
      window.clearTimeout(timeout);
      server.close();
      resolve({ code: code2, redirectUri: redirectUri2 });
    });
    const timeout = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
        reject(new Error("Microsoft sign-in timed out."));
      }
    }, 5 * 6e4);
    server.once("error", (error) => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timeout);
        reject(error);
      }
    });
    server.listen(0, "localhost", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        window.clearTimeout(timeout);
        server.close();
        reject(new Error("Could not start the Microsoft sign-in callback."));
        return;
      }
      const redirectUri2 = `http://localhost:${address.port}`;
      const auth = new URL("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize");
      auth.search = new URLSearchParams({
        client_id: settings.oneDriveClientId.trim(),
        response_type: "code",
        redirect_uri: redirectUri2,
        response_mode: "query",
        scope: `${settings.oneDriveFullAccess ? "Files.ReadWrite" : "Files.ReadWrite.AppFolder"} offline_access`,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state
      }).toString();
      window.open(auth.toString());
    });
  });
  const { code, redirectUri } = await callback;
  const response = await (0, import_obsidian.requestUrl)({
    url: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams({
      client_id: settings.oneDriveClientId.trim(),
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      scope: `${settings.oneDriveFullAccess ? "Files.ReadWrite" : "Files.ReadWrite.AppFolder"} offline_access`
    }).toString(),
    throw: false
  });
  const data = response.json;
  if (response.status < 200 || response.status >= 300 || !data.access_token || !data.refresh_token) throw new Error(`OneDrive sign-in failed: ${data.error_description ?? response.status}`);
  settings.oneDriveAccessToken = data.access_token;
  settings.oneDriveRefreshToken = data.refresh_token;
  settings.oneDriveAccessTokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1e3;
}
var YandexDiskProvider = class {
  constructor(settings) {
    if (!settings.yandexDiskToken.trim()) throw new Error("Enter a Yandex Disk OAuth token in plugin settings.");
    this.token = settings.yandexDiskToken.trim();
    this.root = cleanPath(settings.remoteFolder);
  }
  remotePath(path) {
    const full = [this.root, cleanPath(path)].filter(Boolean).join("/");
    return full ? `disk:/${full}` : "disk:/";
  }
  async api(url, method = "GET", body) {
    return (0, import_obsidian.requestUrl)({
      url,
      method,
      body,
      headers: { Authorization: `OAuth ${this.token}` },
      throw: false
    });
  }
  async ensureFolder(path) {
    let current = "";
    for (const segment of cleanPath(path).split("/").filter(Boolean)) {
      current = current ? `${current}/${segment}` : segment;
      const response = await this.api(`https://cloud-api.yandex.net/v1/disk/resources?${new URLSearchParams({ path: `disk:/${current}` })}`, "PUT");
      if (response.status !== 409) assertSuccess(response.status, `Could not create Yandex Disk folder "${current}"`);
    }
  }
  async list() {
    await this.ensureFolder(this.root);
    const output = [];
    const queue = [this.root ? `disk:/${this.root}` : "disk:/"];
    while (queue.length) {
      const folderPath = queue.shift();
      let offset = 0;
      let total = Number.POSITIVE_INFINITY;
      while (offset < total) {
        const params2 = new URLSearchParams({ path: folderPath, limit: "1000", offset: String(offset), fields: "_embedded.items.name,_embedded.items.path,_embedded.items.type,_embedded.items.modified,_embedded.items.size,_embedded.total" });
        const response = await this.api(`https://cloud-api.yandex.net/v1/disk/resources?${params2}`);
        assertSuccess(response.status, "Could not list Yandex Disk folder");
        const page = response.json;
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
  async read(path) {
    const response = await this.api(`https://cloud-api.yandex.net/v1/disk/resources/download?${new URLSearchParams({ path: this.remotePath(path) })}`);
    assertSuccess(response.status, `Could not prepare Yandex Disk download for "${path}"`);
    const href = response.json.href;
    if (!href) throw new Error(`Yandex Disk did not return a download link for "${path}".`);
    const download = await (0, import_obsidian.requestUrl)({ url: href, method: "GET", throw: false });
    assertSuccess(download.status, `Could not download Yandex Disk file "${path}"`);
    return download.arrayBuffer;
  }
  async write(path, data) {
    const parent = cleanPath(path).split("/").slice(0, -1).join("/");
    await this.ensureFolder([this.root, parent].filter(Boolean).join("/"));
    const response = await this.api(`https://cloud-api.yandex.net/v1/disk/resources/upload?${new URLSearchParams({ path: this.remotePath(path), overwrite: "true" })}`);
    assertSuccess(response.status, `Could not prepare Yandex Disk upload for "${path}"`);
    const href = response.json.href;
    if (!href) throw new Error(`Yandex Disk did not return an upload link for "${path}".`);
    const upload = await (0, import_obsidian.requestUrl)({ url: href, method: "PUT", body: data, headers: { "Content-Type": "application/octet-stream" }, throw: false });
    assertSuccess(upload.status, `Could not upload Yandex Disk file "${path}"`);
  }
  async delete(path) {
    const response = await this.api(`https://cloud-api.yandex.net/v1/disk/resources?${new URLSearchParams({ path: this.remotePath(path), permanently: "true" })}`, "DELETE");
    if (response.status !== 404) assertSuccess(response.status, `Could not delete Yandex Disk file "${path}"`);
  }
};
var PCloudProvider = class {
  constructor(settings) {
    this.fileIds = /* @__PURE__ */ new Map();
    if (!settings.pcloudToken.trim()) throw new Error("Enter a pCloud OAuth token in plugin settings.");
    this.settings = settings;
    this.apiHost = settings.pcloudRegion === "eu" ? "https://eapi.pcloud.com" : "https://api.pcloud.com";
    this.root = cleanPath(settings.remoteFolder);
  }
  async api(method, params2 = {}) {
    const query = new URLSearchParams({ ...params2, access_token: this.settings.pcloudToken.trim() });
    const response = await (0, import_obsidian.requestUrl)({ url: `${this.apiHost}/${method}?${query}`, method: "GET", throw: false });
    const data = response.json;
    if (response.status < 200 || response.status >= 300 || data.result !== 0) throw new Error(`pCloud ${method} failed: ${data.error ?? `result ${data.result}`}`);
    return data;
  }
  path(path) {
    return `/${[this.root, cleanPath(path)].filter(Boolean).join("/")}`;
  }
  flatten(items, parent, output) {
    for (const item of items) {
      const path = cleanPath(parent ? `${parent}/${item.name}` : item.name);
      if (item.isfolder) this.flatten(item.contents ?? [], path, output);
      else {
        if (item.fileid) this.fileIds.set(path, item.fileid);
        output.push({ path, mtime: item.modified ? Date.parse(item.modified) || 0 : 0, size: item.size ?? 0, isFolder: false });
      }
    }
  }
  async list() {
    this.fileIds.clear();
    const response = await this.api("listfolder", { path: this.root ? `/${this.root}` : "/", recursive: "1" });
    const output = [];
    this.flatten(response.metadata?.contents ?? response.contents ?? [], "", output);
    return output;
  }
  async read(path) {
    let fileId = this.fileIds.get(cleanPath(path));
    if (!fileId) {
      const stat = await this.api("stat", { path: this.path(path) });
      fileId = stat.metadata?.fileid;
    }
    if (!fileId) throw new Error(`pCloud file not found: ${path}`);
    const link = await this.api("getfilelink", { fileid: String(fileId) });
    if (!link.hosts?.length || !link.path) throw new Error(`pCloud did not return a download link for "${path}".`);
    const response = await (0, import_obsidian.requestUrl)({ url: `https://${link.hosts[0]}${link.path}`, method: "GET", throw: false });
    assertSuccess(response.status, `Could not download pCloud file "${path}"`);
    return response.arrayBuffer;
  }
  async ensureFolder(path) {
    if (!cleanPath(path)) return 0;
    const params2 = new URLSearchParams({ path: path ? `/${path}` : "/", access_token: this.settings.pcloudToken.trim() });
    const response = await (0, import_obsidian.requestUrl)({ url: `${this.apiHost}/createfolderifnotexists?${params2}`, method: "GET", throw: false });
    const data = response.json;
    if (response.status < 200 || response.status >= 300 || data.result !== 0 || !data.metadata?.folderid) throw new Error(`Could not create pCloud folder "${path}": ${data.error ?? data.result}`);
    return data.metadata.folderid;
  }
  async write(path, data, mtime) {
    const parent = cleanPath(path).split("/").slice(0, -1).join("/");
    const folderId = await this.ensureFolder([this.root, parent].filter(Boolean).join("/"));
    const filename = cleanPath(path).split("/").pop();
    const boundary = `my-cloud-sync-${crypto.randomUUID()}`;
    const query = new URLSearchParams({ folderid: String(folderId), filename, mtime: String(Math.floor(mtime / 1e3)), nopartial: "1", access_token: this.settings.pcloudToken.trim() });
    const prefix = encoder.encode(`--${boundary}\r
Content-Disposition: form-data; name="file"; filename="${filename.replace(/["\\\r\n]/g, "_")}"\r
Content-Type: application/octet-stream\r
\r
`);
    const suffix = encoder.encode(`\r
--${boundary}--\r
`);
    const body = concatenate([prefix, new Uint8Array(data), suffix]);
    const response = await (0, import_obsidian.requestUrl)({ url: `${this.apiHost}/uploadfile?${query}`, method: "POST", body, headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, throw: false });
    const result = response.json;
    if (response.status < 200 || response.status >= 300 || result.result !== 0) throw new Error(`pCloud upload failed: ${result.error ?? `result ${result.result}`}`);
  }
  async delete(path) {
    const fileId = this.fileIds.get(cleanPath(path));
    const params2 = fileId ? { fileid: String(fileId) } : { path: this.path(path) };
    await this.api("deletefile", params2);
  }
};
var WebdisProvider = class {
  constructor(settings) {
    if (!settings.webdisUrl.trim()) throw new Error("Enter the Webdis server URL in plugin settings.");
    this.baseUrl = new URL(settings.webdisUrl.trim());
    if (this.baseUrl.protocol !== "https:" && !(this.baseUrl.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(this.baseUrl.hostname))) throw new Error("Webdis must use HTTPS (HTTP is allowed only on localhost).");
    if (this.baseUrl.username || this.baseUrl.password || this.baseUrl.hash) throw new Error("Enter Webdis credentials in their settings fields, not in the URL.");
    this.baseUrl.pathname = `${this.baseUrl.pathname.replace(/\/+$/, "")}/`;
    this.prefix = `my-cloud-sync:${encodeURIComponent(cleanPath(settings.remoteFolder))}/`;
    this.headers = {};
    if (settings.webdisUsername || settings.webdisPassword) this.headers.Authorization = encodeBasicAuth(settings.webdisUsername, settings.webdisPassword);
  }
  key(path, metadata = false) {
    return `${this.prefix}${metadata ? "m:" : "f:"}${encodeURIComponent(cleanPath(path))}`;
  }
  commandUrl(command, key, raw = false) {
    const suffix = raw ? ".raw" : ".json";
    return new URL(`${command}/${encodeURIComponent(key)}${suffix}`, this.baseUrl).toString();
  }
  async request(url, method = "GET", body) {
    return (0, import_obsidian.requestUrl)({ url, method, body, headers: this.headers, throw: false });
  }
  async list() {
    const output = [];
    let cursor = "0";
    do {
      const scanUrl = new URL(`SCAN/${encodeURIComponent(cursor)}/MATCH/${encodeURIComponent(`${this.prefix}f:*`)}/COUNT/1000.json`, this.baseUrl);
      const response = await (0, import_obsidian.requestUrl)({ url: scanUrl.toString(), headers: this.headers, throw: false });
      assertSuccess(response.status, "Could not scan Webdis keys");
      const scan = response.json;
      const [next, keys2] = scan.SCAN ?? ["0", []];
      cursor = next;
      for (const key of keys2) {
        if (!key.startsWith(`${this.prefix}f:`)) continue;
        const encodedPath = key.slice(`${this.prefix}f:`.length);
        let path;
        try {
          path = decodeURIComponent(encodedPath);
        } catch {
          continue;
        }
        if (!path || path.split("/").some((part) => part === "." || part === "..")) continue;
        const meta = await this.request(this.commandUrl("GET", this.key(path, true), true));
        const [mtimeValue, sizeValue] = meta.status === 404 ? ["0", "0"] : meta.text.split(":");
        output.push({ path, mtime: Number(mtimeValue) || 0, size: Number(sizeValue) || 0, isFolder: false });
      }
    } while (cursor !== "0");
    return output;
  }
  async read(path) {
    const response = await this.request(this.commandUrl("GET", this.key(path), true));
    assertSuccess(response.status, `Could not read Webdis key for "${path}"`);
    return response.arrayBuffer;
  }
  async write(path, data, mtime) {
    const content = await this.request(this.commandUrl("SET", this.key(path)), "PUT", data);
    assertSuccess(content.status, `Could not write Webdis key for "${path}"`);
    const stamp = encoder.encode(`${mtime}:${data.byteLength}`);
    const metadata = await this.request(this.commandUrl("SET", this.key(path, true)), "PUT", toArrayBuffer(stamp));
    assertSuccess(metadata.status, `Could not update Webdis timestamp for "${path}"`);
  }
  async delete(path) {
    const keys2 = [this.key(path), this.key(path, true)];
    const url = new URL(`DEL/${keys2.map(encodeURIComponent).join("/")}.json`, this.baseUrl);
    const response = await this.request(url.toString());
    assertSuccess(response.status, `Could not delete Webdis keys for "${path}"`);
  }
};
var BoxProvider = class {
  constructor(settings) {
    this.rootId = "";
    this.fileIds = /* @__PURE__ */ new Map();
    if (!settings.boxClientId.trim() || !settings.boxClientSecret || !settings.boxRefreshToken) throw new Error("Set Box OAuth credentials and connect your account in plugin settings.");
    this.settings = settings;
    this.rootPath = cleanPath(settings.remoteFolder);
  }
  async accessToken() {
    if (this.settings.boxAccessToken && Date.now() < this.settings.boxAccessTokenExpiresAt - 6e4) return this.settings.boxAccessToken;
    const response = await (0, import_obsidian.requestUrl)({
      url: "https://api.box.com/oauth2/token",
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        client_id: this.settings.boxClientId.trim(),
        client_secret: this.settings.boxClientSecret,
        grant_type: "refresh_token",
        refresh_token: this.settings.boxRefreshToken
      }).toString(),
      throw: false
    });
    const data = response.json;
    if (response.status < 200 || response.status >= 300 || !data.access_token || !data.refresh_token) throw new Error(`Box token refresh failed: ${data.error_description ?? response.status}`);
    this.settings.boxAccessToken = data.access_token;
    this.settings.boxRefreshToken = data.refresh_token;
    this.settings.boxAccessTokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1e3;
    return data.access_token;
  }
  async api(url, method = "GET", body, contentType) {
    const response = await (0, import_obsidian.requestUrl)({
      url: url.startsWith("http") ? url : `https://api.box.com/2.0${url}`,
      method,
      body,
      headers: { Authorization: `Bearer ${await this.accessToken()}` },
      contentType,
      throw: false
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`Box request failed (HTTP ${response.status}): ${response.text.slice(0, 250)}`);
    return response;
  }
  async children(folderId) {
    const items = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    while (offset < total) {
      const params2 = new URLSearchParams({ limit: "1000", offset: String(offset), fields: "id,name,type,size,modified_at" });
      const page = (await this.api(`/folders/${encodeURIComponent(folderId)}/items?${params2}`)).json;
      const entries = page.entries ?? [];
      items.push(...entries);
      total = page.total_count ?? entries.length;
      offset += entries.length;
      if (!entries.length) break;
    }
    return items;
  }
  async ensureFolder(parentId, name) {
    const existing = (await this.children(parentId)).filter((item) => item.type === "folder" && item.name === name);
    if (existing.length > 1) throw new Error(`Box has duplicate folders named "${name}".`);
    if (existing.length) return existing[0].id;
    const response = await this.api("/folders", "POST", JSON.stringify({ name, parent: { id: parentId } }), "application/json");
    return response.json.id;
  }
  async rootFolder() {
    if (this.rootId) return this.rootId;
    let parent = "0";
    for (const segment of this.rootPath.split("/").filter(Boolean)) parent = await this.ensureFolder(parent, segment);
    this.rootId = parent;
    return parent;
  }
  async list() {
    this.fileIds.clear();
    const output = [];
    const queue = [{ id: await this.rootFolder(), path: "" }];
    while (queue.length) {
      const folder = queue.shift();
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
  async read(path) {
    const id2 = this.fileIds.get(cleanPath(path));
    if (!id2) throw new Error(`Box file not found: ${path}`);
    const response = await this.api(`/files/${encodeURIComponent(id2)}/content`);
    return response.arrayBuffer;
  }
  async write(path, data) {
    const parts = cleanPath(path).split("/");
    let parentId = await this.rootFolder();
    for (const segment of parts.slice(0, -1)) parentId = await this.ensureFolder(parentId, segment);
    const filename = parts[parts.length - 1];
    const existing = (await this.children(parentId)).filter((item) => item.type === "file" && item.name === filename);
    if (existing.length > 1) throw new Error(`Box has duplicate files named "${path}".`);
    const boundary = `my-cloud-sync-${crypto.randomUUID()}`;
    const attributes = existing.length ? { name: filename } : { name: filename, parent: { id: parentId } };
    const prefix = encoder.encode(`--${boundary}\r
Content-Disposition: form-data; name="attributes"\r
Content-Type: application/json\r
\r
${JSON.stringify(attributes)}\r
--${boundary}\r
Content-Disposition: form-data; name="file"; filename="${filename.replace(/["\\\r\n]/g, "_")}"\r
Content-Type: application/octet-stream\r
\r
`);
    const suffix = encoder.encode(`\r
--${boundary}--\r
`);
    const body = concatenate([prefix, new Uint8Array(data), suffix]);
    const url = existing.length ? `https://upload.box.com/api/2.0/files/${encodeURIComponent(existing[0].id)}/content` : "https://upload.box.com/api/2.0/files/content";
    const response = await this.api(url, "POST", body, `multipart/form-data; boundary=${boundary}`);
    if (response.status !== 201 && response.status !== 202) assertSuccess(response.status, `Could not upload Box file "${path}"`);
  }
  async delete(path) {
    const id2 = this.fileIds.get(cleanPath(path));
    if (!id2) return;
    await this.api(`/files/${encodeURIComponent(id2)}`, "DELETE");
  }
};
async function connectBox(settings) {
  if (import_obsidian.Platform.isMobile) throw new Error("Box sign-in needs a local browser callback and must be connected on desktop. After connecting there, securely transfer the plugin settings to this device.");
  if (!settings.boxClientId.trim() || !settings.boxClientSecret) throw new Error("Enter the Box client ID and client secret first.");
  const redirect = new URL(settings.boxRedirectUri);
  if (redirect.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(redirect.hostname) || !redirect.port) throw new Error("Box redirect URI must be a localhost URL with an explicit port, for example http://localhost:53682/callback.");
  const http = await import("http");
  const state = Array.from(crypto.getRandomValues(new Uint8Array(24))).map((value) => value.toString(16).padStart(2, "0")).join("");
  const callback = new Promise((resolve, reject) => {
    const server = http.createServer((request, response2) => {
      const callbackUrl = new URL(request.url ?? "/", settings.boxRedirectUri);
      if (callbackUrl.pathname !== redirect.pathname) {
        response2.writeHead(404).end("Not found.");
        return;
      }
      if (callbackUrl.searchParams.get("state") !== state) {
        response2.writeHead(400).end("OAuth state mismatch.");
        window.clearTimeout(timeout);
        server.close();
        reject(new Error("Box sign-in state did not match."));
        return;
      }
      const error = callbackUrl.searchParams.get("error");
      if (error) {
        response2.writeHead(400).end("Box sign-in was cancelled.");
        window.clearTimeout(timeout);
        server.close();
        reject(new Error(`Box sign-in failed: ${error}`));
        return;
      }
      const code2 = callbackUrl.searchParams.get("code");
      if (!code2) {
        response2.writeHead(400).end("Box did not return an authorization code.");
        window.clearTimeout(timeout);
        server.close();
        reject(new Error("Box did not return an authorization code."));
        return;
      }
      response2.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("<p>Box connected. Return to Obsidian.</p>");
      window.clearTimeout(timeout);
      server.close();
      resolve(code2);
    });
    const timeout = window.setTimeout(() => {
      server.close();
      reject(new Error("Box sign-in timed out."));
    }, 5 * 6e4);
    server.once("error", (error) => {
      window.clearTimeout(timeout);
      reject(new Error(`Could not open the Box callback listener: ${error.message}`));
    });
    server.listen(Number(redirect.port), redirect.hostname, () => {
      const auth = new URL("https://account.box.com/api/oauth2/authorize");
      auth.search = new URLSearchParams({ response_type: "code", client_id: settings.boxClientId.trim(), redirect_uri: settings.boxRedirectUri, state }).toString();
      window.open(auth.toString());
    });
  });
  const code = await callback;
  const response = await (0, import_obsidian.requestUrl)({
    url: "https://api.box.com/oauth2/token",
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: settings.boxClientId.trim(), client_secret: settings.boxClientSecret, redirect_uri: settings.boxRedirectUri }).toString(),
    throw: false
  });
  const data = response.json;
  if (response.status < 200 || response.status >= 300 || !data.access_token || !data.refresh_token) throw new Error(`Box connection failed: ${data.error_description ?? response.status}`);
  settings.boxAccessToken = data.access_token;
  settings.boxRefreshToken = data.refresh_token;
  settings.boxAccessTokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1e3;
}
function createProvider(settings) {
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
async function connectGoogleDrive(settings) {
  if (import_obsidian.Platform.isMobile) throw new Error("Google's current desktop OAuth callback cannot be opened by Obsidian Mobile. Connect Google Drive on desktop, then securely transfer the plugin settings to this device.");
  if (!settings.googleClientId.trim()) {
    throw new Error("Enter a Google OAuth desktop client ID before connecting.");
  }
  const http = await import("http");
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((value) => value.toString(16).padStart(2, "0")).join("");
  const challengeBytes = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const state = Array.from(crypto.getRandomValues(new Uint8Array(24))).map((value) => value.toString(16).padStart(2, "0")).join("");
  const callbackCode = new Promise(
    (resolve, reject) => {
      let settled = false;
      const server = http.createServer((request, response2) => {
        const address = server.address();
        if (!address || typeof address === "string") {
          response2.writeHead(500).end("OAuth callback server error.");
          return;
        }
        const redirectUri2 = `http://127.0.0.1:${address.port}`;
        const callback = new URL(request.url ?? "/", redirectUri2);
        if (callback.pathname !== "/") {
          response2.writeHead(404).end("Not found.");
          return;
        }
        if (callback.searchParams.get("state") !== state) {
          response2.writeHead(400).end("OAuth state did not match.");
          return;
        }
        const oauthError = callback.searchParams.get("error");
        if (oauthError) {
          response2.writeHead(400).end("Google sign-in was cancelled or denied.");
          settled = true;
          window.clearTimeout(timeout);
          server.close();
          reject(new Error(`Google sign-in was not completed: ${oauthError}`));
          return;
        }
        const code2 = callback.searchParams.get("code");
        if (!code2) {
          response2.writeHead(400).end("Google did not return an authorization code.");
          return;
        }
        response2.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response2.end("<p>Google Drive connected. You can close this tab and return to Obsidian.</p>");
        settled = true;
        window.clearTimeout(timeout);
        server.close();
        resolve({ code: code2, redirectUri: redirectUri2 });
      });
      const timeout = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          server.close();
          reject(new Error("Google sign-in timed out. Please try again."));
        }
      }, 5 * 60 * 1e3);
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
        const redirectUri2 = `http://127.0.0.1:${address.port}`;
        const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authUrl.search = new URLSearchParams({
          client_id: settings.googleClientId.trim(),
          redirect_uri: redirectUri2,
          response_type: "code",
          scope: "https://www.googleapis.com/auth/drive",
          access_type: "offline",
          prompt: "consent",
          code_challenge: challenge,
          code_challenge_method: "S256",
          state
        }).toString();
        window.open(authUrl.toString());
      });
    }
  );
  const { code, redirectUri } = await callbackCode;
  const response = await (0, import_obsidian.requestUrl)({
    url: "https://oauth2.googleapis.com/token",
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams({
      client_id: settings.googleClientId.trim(),
      ...settings.googleClientSecret.trim() ? { client_secret: settings.googleClientSecret.trim() } : {},
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    }).toString(),
    throw: false
  });
  const tokens = response.json;
  if (response.status < 200 || response.status >= 300 || !tokens.refresh_token) {
    const detail = tokens.error_description || tokens.error || response.status;
    const secretHint = String(detail).toLowerCase().includes("client_secret") ? " Add the client secret shown for this OAuth client in Google Cloud Console, then try again." : " Ensure the OAuth client is a Desktop app.";
    throw new Error(`Google sign-in failed: ${detail}.${secretHint}`);
  }
  settings.googleRefreshToken = tokens.refresh_token;
  settings.googleAccessToken = tokens.access_token ?? "";
  settings.googleAccessTokenExpiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1e3;
}

// src/sync.ts
function toArrayBuffer2(bytes) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
function diffLines(base, changed) {
  const n = base.length;
  const m = changed.length;
  if (n > 2e3 || m > 2e3 || n * m > 1e5) return void 0;
  const width = m + 1;
  const lcs = new Uint16Array((n + 1) * width);
  for (let i2 = n - 1; i2 >= 0; i2--) {
    for (let j2 = m - 1; j2 >= 0; j2--) {
      const index = i2 * width + j2;
      lcs[index] = base[i2] === changed[j2] ? 1 + lcs[(i2 + 1) * width + j2 + 1] : Math.max(lcs[(i2 + 1) * width + j2], lcs[i2 * width + j2 + 1]);
    }
  }
  const hunks = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && base[i] === changed[j]) {
      i++;
      j++;
      continue;
    }
    const start = i;
    const lines = [];
    while (i < n || j < m) {
      if (i < n && j < m && base[i] === changed[j]) break;
      if (j < m && (i === n || lcs[i * width + j + 1] >= lcs[(i + 1) * width + j])) lines.push(changed[j++]);
      else i++;
    }
    hunks.push({ start, end: i, lines });
  }
  return hunks;
}
function mergeText(baseText, localText, remoteText) {
  if (localText === remoteText) return localText;
  const base = baseText.split("\n");
  const local = diffLines(base, localText.split("\n"));
  const remote = diffLines(base, remoteText.split("\n"));
  if (!local || !remote) return void 0;
  const edits = [...local, ...remote].sort((a, b) => a.start - b.start || a.end - b.end);
  const unique = [];
  for (const edit of edits) {
    const previous = unique[unique.length - 1];
    if (previous && previous.start === edit.start && previous.end === edit.end && previous.lines.join("\n") === edit.lines.join("\n")) continue;
    if (previous && (previous.start === edit.start || previous.end > edit.start)) return void 0;
    unique.push(edit);
  }
  const merged = [];
  let cursor = 0;
  for (const edit of unique) {
    merged.push(...base.slice(cursor, edit.start), ...edit.lines);
    cursor = edit.end;
  }
  merged.push(...base.slice(cursor));
  return merged.join("\n");
}
var signature = (file) => ({
  mtime: file.mtime,
  size: file.size
});
var sameSignature = (a, b) => a.mtime === b.mtime && a.size === b.size;
async function sameContent(path, readLocal, readRemote) {
  const [local, remote] = await Promise.all([readLocal(path), readRemote(path)]);
  if (local.byteLength !== remote.byteLength) {
    return false;
  }
  const localBytes = new Uint8Array(local);
  const remoteBytes = new Uint8Array(remote);
  return localBytes.every((value, index) => value === remoteBytes[index]);
}
async function runConcurrent(items, concurrency, task) {
  let nextIndex = 0;
  let failure;
  const workerCount = Math.min(items.length, Math.max(1, Math.min(20, Math.floor(concurrency) || 1)));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (failure === void 0) {
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
async function synchronize(localFiles, remoteFiles, baseline, readRemote, readLocal, writeRemote, writeLocal, refresh, conflictAction = "keep-newer", deleteRemote, deleteLocal, syncDeletions = true, shouldCancel = () => false, concurrency = 5) {
  const localByPath = new Map(localFiles.map((file) => [file.path, file]));
  const remoteByPath = new Map(remoteFiles.map((file) => [file.path, file]));
  const paths = /* @__PURE__ */ new Set([...localByPath.keys(), ...remoteByPath.keys()]);
  const conflictedPaths = /* @__PURE__ */ new Set();
  const result = { uploaded: 0, downloaded: 0, conflicts: [] };
  const preserveBoth = async (path) => {
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
  const tryMergeMarkdown = async (path, baseContent) => {
    if (!path.toLowerCase().endsWith(".md") || baseContent === void 0 || baseContent.length > 16e3) return false;
    const [localData, remoteData] = await Promise.all([readLocal(path), readRemote(path)]);
    if (localData.byteLength > 16384 || remoteData.byteLength > 16384) return false;
    let localText;
    let remoteText;
    try {
      localText = new TextDecoder("utf-8", { fatal: true }).decode(localData);
      remoteText = new TextDecoder("utf-8", { fatal: true }).decode(remoteData);
    } catch {
      return false;
    }
    const merged = mergeText(baseContent, localText, remoteText);
    if (merged === void 0) return false;
    const bytes = new TextEncoder().encode(merged);
    const buffer = toArrayBuffer2(bytes);
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
      const previous2 = baseline[path];
      if (syncDeletions && previous2 && sameSignature(signature(local), previous2.local) && deleteLocal) {
        await deleteLocal(path);
        return;
      }
      await writeRemote(path, await readLocal(path), local.mtime);
      result.uploaded++;
      return;
    }
    if (!local && remote) {
      const previous2 = baseline[path];
      if (syncDeletions && previous2 && sameSignature(signature(remote), previous2.remote) && deleteRemote) {
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
    if (previous && sameSignature(localSignature, previous.local) && sameSignature(remoteSignature, previous.remote)) {
      return;
    }
    if (sameSignature(localSignature, remoteSignature)) {
      if (await sameContent(path, readLocal, readRemote)) {
        return;
      }
      if (conflictAction === "merge-markdown" && await tryMergeMarkdown(path, baseline[path]?.baseContent)) return;
      if (conflictAction === "merge-markdown") {
        await preserveBoth(path);
        return;
      }
      if (conflictAction === "prefer-local") {
        await writeRemote(path, await readLocal(path), local.mtime);
        result.uploaded++;
        return;
      }
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
      } else if (conflictAction === "prefer-local") {
        await writeRemote(path, await readLocal(path), local.mtime);
        result.uploaded++;
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
    if (conflictAction === "prefer-local") {
      await writeRemote(path, await readLocal(path), local.mtime);
      result.uploaded++;
    } else if (conflictAction === "keep-both") {
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
  const pathsAfterSync = /* @__PURE__ */ new Set([
    ...refreshedLocal.keys(),
    ...refreshedRemote.keys()
  ]);
  const nextBaseline = {};
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
      const next = {
        local: signature(local),
        remote: signature(remote)
      };
      if (path.toLowerCase().endsWith(".md") && local.size <= 16384 && storedMergeBaseBytes + local.size <= 512 * 1024) {
        try {
          const bytes = await readLocal(path);
          next.baseContent = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          storedMergeBaseBytes += bytes.byteLength;
        } catch {
        }
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

// src/encryption.ts
var MAGIC = new Uint8Array([77, 67, 83, 49]);
var SALT_LENGTH = 16;
var IV_LENGTH = 12;
var ITERATIONS = 31e4;
var PATH_PREFIX = "~mcs1~";
var OPENSSL_MAGIC = new Uint8Array([83, 97, 108, 116, 101, 100, 95, 95]);
var OPENSSL_PATH_PREFIX = "~ossl~";
var OPENSSL_ITERATIONS = 2e4;
var pathKeys;
function toArrayBuffer3(bytes) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
function webCrypto() {
  if (!window.crypto?.subtle) throw new Error("Web Crypto is unavailable in this Obsidian environment.");
  return window.crypto;
}
async function deriveKey(password, salt) {
  const crypto2 = webCrypto();
  const material = await crypto2.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const saltBuffer = toArrayBuffer3(salt);
  return crypto2.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations: ITERATIONS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function encryptFile(data, password) {
  const crypto2 = webCrypto();
  const salt = crypto2.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto2.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);
  const encrypted = new Uint8Array(await crypto2.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  const output = new Uint8Array(MAGIC.length + salt.length + iv.length + encrypted.length);
  output.set(MAGIC, 0);
  output.set(salt, MAGIC.length);
  output.set(iv, MAGIC.length + salt.length);
  output.set(encrypted, MAGIC.length + salt.length + iv.length);
  return output.buffer;
}
async function encryptOpenSsl(data, password) {
  const crypto2 = webCrypto();
  const salt = crypto2.getRandomValues(new Uint8Array(8));
  const material = await crypto2.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = toArrayBuffer3(salt);
  const derived = new Uint8Array(await crypto2.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations: OPENSSL_ITERATIONS },
    material,
    384
  ));
  const keyBytes = derived.slice(0, 32);
  const iv = derived.slice(32, 48);
  const key = await crypto2.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto2.subtle.encrypt({ name: "AES-CBC", iv }, key, data));
  const output = new Uint8Array(OPENSSL_MAGIC.length + salt.length + encrypted.length);
  output.set(OPENSSL_MAGIC, 0);
  output.set(salt, OPENSSL_MAGIC.length);
  output.set(encrypted, OPENSSL_MAGIC.length + salt.length);
  return output.buffer;
}
async function decryptOpenSsl(data, password) {
  const headerLength = OPENSSL_MAGIC.length + 8;
  if (data.length < headerLength + 16 || !OPENSSL_MAGIC.every((byte, index) => data[index] === byte)) {
    throw new Error("Could not decrypt OpenSSL-format data. The encrypted file may be damaged.");
  }
  const salt = data.slice(OPENSSL_MAGIC.length, headerLength);
  const material = await webCrypto().subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = toArrayBuffer3(salt);
  const derived = new Uint8Array(await webCrypto().subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations: OPENSSL_ITERATIONS },
    material,
    384
  ));
  const key = await webCrypto().subtle.importKey("raw", derived.slice(0, 32), { name: "AES-CBC" }, false, ["decrypt"]);
  try {
    return await webCrypto().subtle.decrypt({ name: "AES-CBC", iv: derived.slice(32, 48) }, key, data.slice(headerLength));
  } catch {
    throw new Error("OpenSSL-compatible decryption failed. Check the password or whether the file is damaged.");
  }
}
async function encryptFileWithMethod(data, password, method) {
  return method === "openssl-aes-cbc" ? encryptOpenSsl(data, password) : encryptFile(data, password);
}
async function decryptFile(data, password) {
  const input = new Uint8Array(data);
  if (OPENSSL_MAGIC.every((byte, index) => input[index] === byte)) return decryptOpenSsl(input, password);
  const headerLength = MAGIC.length + SALT_LENGTH + IV_LENGTH;
  if (!MAGIC.every((byte, index) => input[index] === byte)) return data;
  if (input.length < headerLength + 16) {
    throw new Error("Could not decrypt remote file. The encrypted file may be damaged.");
  }
  const salt = input.slice(MAGIC.length, MAGIC.length + SALT_LENGTH);
  const iv = input.slice(MAGIC.length + SALT_LENGTH, headerLength);
  const key = await deriveKey(password, salt);
  try {
    return await webCrypto().subtle.decrypt({ name: "AES-GCM", iv }, key, input.slice(headerLength));
  } catch {
    throw new Error("Could not decrypt remote file. The encryption password may be incorrect or the file may be damaged.");
  }
}
async function getPathKeys(password) {
  if (pathKeys?.password === password) return pathKeys;
  const crypto2 = webCrypto();
  const material = await crypto2.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto2.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: new TextEncoder().encode("My Cloud Sync path names v1"),
    iterations: ITERATIONS
  }, material, 512);
  const bytes = new Uint8Array(bits);
  const enc = await crypto2.subtle.importKey("raw", bytes.slice(0, 32), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  const mac = await crypto2.subtle.importKey("raw", bytes.slice(32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  pathKeys = { password, enc, mac };
  return pathKeys;
}
async function pathIv(name, mac) {
  const digest = new Uint8Array(await webCrypto().subtle.sign("HMAC", mac, new TextEncoder().encode(name)));
  return digest.slice(0, 12);
}
function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function encryptPath(path, password, method = "aes-gcm") {
  if (method === "openssl-aes-cbc") {
    return (await Promise.all(path.split("/").map(async (part) => {
      if (!part) return part;
      const plain = new TextEncoder().encode(part);
      const encrypted = await encryptOpenSsl(toArrayBuffer3(plain), password);
      return `${OPENSSL_PATH_PREFIX}${toBase64Url(new Uint8Array(encrypted))}`;
    }))).join("/");
  }
  const parts = path.split("/");
  const { enc, mac } = await getPathKeys(password);
  return (await Promise.all(parts.map(async (part) => {
    if (!part) return part;
    const iv = await pathIv(part, mac);
    const encoded = new TextEncoder().encode(part);
    const cipher = new Uint8Array(await webCrypto().subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer3(iv) },
      enc,
      toArrayBuffer3(encoded)
    ));
    const output = new Uint8Array(iv.length + cipher.length);
    output.set(iv);
    output.set(cipher, iv.length);
    return `${PATH_PREFIX}${toBase64Url(output)}`;
  }))).join("/");
}
async function decryptPath(path, password) {
  const parts = path.split("/");
  const { enc, mac } = await getPathKeys(password);
  return (await Promise.all(parts.map(async (part) => {
    if (part.startsWith(OPENSSL_PATH_PREFIX)) {
      try {
        const input = fromBase64Url(part.slice(OPENSSL_PATH_PREFIX.length));
        const plain = await decryptOpenSsl(input, password);
        return new TextDecoder("utf-8", { fatal: true }).decode(plain);
      } catch {
        throw new Error("Could not decrypt OpenSSL-format file or folder names. Check that the encryption password matches.");
      }
    }
    if (!part || !part.startsWith(PATH_PREFIX)) return part;
    try {
      const input = fromBase64Url(part.slice(PATH_PREFIX.length));
      const iv = input.slice(0, 12);
      const plain = await webCrypto().subtle.decrypt({ name: "AES-GCM", iv }, enc, input.slice(12));
      const name = new TextDecoder("utf-8", { fatal: true }).decode(plain);
      const expectedIv = await pathIv(name, mac);
      if (!expectedIv.every((byte, i) => byte === iv[i])) throw new Error("Invalid encrypted path");
      return name;
    } catch {
      throw new Error("Could not decrypt remote file or folder names. Check that the same encryption password is set on every device.");
    }
  }))).join("/");
}

// node_modules/lib0/map.js
var create = () => /* @__PURE__ */ new Map();
var copy = (m) => {
  const r = create();
  m.forEach((v, k) => {
    r.set(k, v);
  });
  return r;
};
var setIfUndefined = (map2, key, createT) => {
  let set = map2.get(key);
  if (set === void 0) {
    map2.set(key, set = createT());
  }
  return set;
};
var map = (m, f) => {
  const res = [];
  for (const [key, value] of m) {
    res.push(f(value, key));
  }
  return res;
};
var any = (m, f) => {
  for (const [key, value] of m) {
    if (f(value, key)) {
      return true;
    }
  }
  return false;
};

// node_modules/lib0/set.js
var create2 = () => /* @__PURE__ */ new Set();

// node_modules/lib0/array.js
var last = (arr) => arr[arr.length - 1];
var appendTo = (dest, src) => {
  for (let i = 0; i < src.length; i++) {
    dest.push(src[i]);
  }
};
var from = Array.from;
var every = (arr, f) => {
  for (let i = 0; i < arr.length; i++) {
    if (!f(arr[i], i, arr)) {
      return false;
    }
  }
  return true;
};
var some = (arr, f) => {
  for (let i = 0; i < arr.length; i++) {
    if (f(arr[i], i, arr)) {
      return true;
    }
  }
  return false;
};
var unfold = (len, f) => {
  const array = new Array(len);
  for (let i = 0; i < len; i++) {
    array[i] = f(i, array);
  }
  return array;
};
var isArray = Array.isArray;

// node_modules/lib0/observable.js
var ObservableV2 = class {
  constructor() {
    this._observers = create();
  }
  /**
   * @template {keyof EVENTS & string} NAME
   * @param {NAME} name
   * @param {EVENTS[NAME]} f
   */
  on(name, f) {
    setIfUndefined(
      this._observers,
      /** @type {string} */
      name,
      create2
    ).add(f);
    return f;
  }
  /**
   * @template {keyof EVENTS & string} NAME
   * @param {NAME} name
   * @param {EVENTS[NAME]} f
   */
  once(name, f) {
    const _f = (...args2) => {
      this.off(
        name,
        /** @type {any} */
        _f
      );
      f(...args2);
    };
    this.on(
      name,
      /** @type {any} */
      _f
    );
  }
  /**
   * @template {keyof EVENTS & string} NAME
   * @param {NAME} name
   * @param {EVENTS[NAME]} f
   */
  off(name, f) {
    const observers = this._observers.get(name);
    if (observers !== void 0) {
      observers.delete(f);
      if (observers.size === 0) {
        this._observers.delete(name);
      }
    }
  }
  /**
   * Emit a named event. All registered event listeners that listen to the
   * specified name will receive the event.
   *
   * @todo This should catch exceptions
   *
   * @template {keyof EVENTS & string} NAME
   * @param {NAME} name The event name.
   * @param {Parameters<EVENTS[NAME]>} args The arguments that are applied to the event listener.
   */
  emit(name, args2) {
    return from((this._observers.get(name) || create()).values()).forEach((f) => f(...args2));
  }
  destroy() {
    this._observers = create();
  }
};

// node_modules/lib0/math.js
var floor = Math.floor;
var abs = Math.abs;
var min = (a, b) => a < b ? a : b;
var max = (a, b) => a > b ? a : b;
var isNaN = Number.isNaN;
var isNegativeZero = (n) => n !== 0 ? n < 0 : 1 / n < 0;

// node_modules/lib0/binary.js
var BIT1 = 1;
var BIT2 = 2;
var BIT3 = 4;
var BIT4 = 8;
var BIT6 = 32;
var BIT7 = 64;
var BIT8 = 128;
var BIT18 = 1 << 17;
var BIT19 = 1 << 18;
var BIT20 = 1 << 19;
var BIT21 = 1 << 20;
var BIT22 = 1 << 21;
var BIT23 = 1 << 22;
var BIT24 = 1 << 23;
var BIT25 = 1 << 24;
var BIT26 = 1 << 25;
var BIT27 = 1 << 26;
var BIT28 = 1 << 27;
var BIT29 = 1 << 28;
var BIT30 = 1 << 29;
var BIT31 = 1 << 30;
var BIT32 = 1 << 31;
var BITS5 = 31;
var BITS6 = 63;
var BITS7 = 127;
var BITS17 = BIT18 - 1;
var BITS18 = BIT19 - 1;
var BITS19 = BIT20 - 1;
var BITS20 = BIT21 - 1;
var BITS21 = BIT22 - 1;
var BITS22 = BIT23 - 1;
var BITS23 = BIT24 - 1;
var BITS24 = BIT25 - 1;
var BITS25 = BIT26 - 1;
var BITS26 = BIT27 - 1;
var BITS27 = BIT28 - 1;
var BITS28 = BIT29 - 1;
var BITS29 = BIT30 - 1;
var BITS30 = BIT31 - 1;
var BITS31 = 2147483647;

// node_modules/lib0/number.js
var MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
var MIN_SAFE_INTEGER = Number.MIN_SAFE_INTEGER;
var LOWEST_INT32 = 1 << 31;
var isInteger = Number.isInteger || ((num) => typeof num === "number" && isFinite(num) && floor(num) === num);
var isNaN2 = Number.isNaN;
var parseInt = Number.parseInt;

// node_modules/lib0/string.js
var fromCharCode = String.fromCharCode;
var fromCodePoint = String.fromCodePoint;
var MAX_UTF16_CHARACTER = fromCharCode(65535);
var toLowerCase = (s) => s.toLowerCase();
var trimLeftRegex = /^\s*/g;
var trimLeft = (s) => s.replace(trimLeftRegex, "");
var fromCamelCaseRegex = /([A-Z])/g;
var fromCamelCase = (s, separator) => trimLeft(s.replace(fromCamelCaseRegex, (match2) => `${separator}${toLowerCase(match2)}`));
var _encodeUtf8Polyfill = (str) => {
  const encodedString = unescape(encodeURIComponent(str));
  const len = encodedString.length;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    buf[i] = /** @type {number} */
    encodedString.codePointAt(i);
  }
  return buf;
};
var utf8TextEncoder = (
  /** @type {TextEncoder} */
  typeof TextEncoder !== "undefined" ? new TextEncoder() : null
);
var _encodeUtf8Native = (str) => utf8TextEncoder.encode(str);
var encodeUtf8 = utf8TextEncoder ? _encodeUtf8Native : _encodeUtf8Polyfill;
var utf8TextDecoder = typeof TextDecoder === "undefined" ? null : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
if (utf8TextDecoder && utf8TextDecoder.decode(new Uint8Array()).length === 1) {
  utf8TextDecoder = null;
}
var repeat = (source, n) => unfold(n, () => source).join("");

// node_modules/lib0/encoding.js
var Encoder = class {
  constructor() {
    this.cpos = 0;
    this.cbuf = new Uint8Array(100);
    this.bufs = [];
  }
};
var createEncoder = () => new Encoder();
var length = (encoder2) => {
  let len = encoder2.cpos;
  for (let i = 0; i < encoder2.bufs.length; i++) {
    len += encoder2.bufs[i].length;
  }
  return len;
};
var toUint8Array = (encoder2) => {
  const uint8arr = new Uint8Array(length(encoder2));
  let curPos = 0;
  for (let i = 0; i < encoder2.bufs.length; i++) {
    const d = encoder2.bufs[i];
    uint8arr.set(d, curPos);
    curPos += d.length;
  }
  uint8arr.set(new Uint8Array(encoder2.cbuf.buffer, 0, encoder2.cpos), curPos);
  return uint8arr;
};
var verifyLen = (encoder2, len) => {
  const bufferLen = encoder2.cbuf.length;
  if (bufferLen - encoder2.cpos < len) {
    encoder2.bufs.push(new Uint8Array(encoder2.cbuf.buffer, 0, encoder2.cpos));
    encoder2.cbuf = new Uint8Array(max(bufferLen, len) * 2);
    encoder2.cpos = 0;
  }
};
var write = (encoder2, num) => {
  const bufferLen = encoder2.cbuf.length;
  if (encoder2.cpos === bufferLen) {
    encoder2.bufs.push(encoder2.cbuf);
    encoder2.cbuf = new Uint8Array(bufferLen * 2);
    encoder2.cpos = 0;
  }
  encoder2.cbuf[encoder2.cpos++] = num;
};
var writeUint8 = write;
var writeVarUint = (encoder2, num) => {
  while (num > BITS7) {
    write(encoder2, BIT8 | BITS7 & num);
    num = floor(num / 128);
  }
  write(encoder2, BITS7 & num);
};
var writeVarInt = (encoder2, num) => {
  const isNegative = isNegativeZero(num);
  if (isNegative) {
    num = -num;
  }
  write(encoder2, (num > BITS6 ? BIT8 : 0) | (isNegative ? BIT7 : 0) | BITS6 & num);
  num = floor(num / 64);
  while (num > 0) {
    write(encoder2, (num > BITS7 ? BIT8 : 0) | BITS7 & num);
    num = floor(num / 128);
  }
};
var _strBuffer = new Uint8Array(3e4);
var _maxStrBSize = _strBuffer.length / 3;
var _writeVarStringNative = (encoder2, str) => {
  if (str.length < _maxStrBSize) {
    const written = utf8TextEncoder.encodeInto(str, _strBuffer).written || 0;
    writeVarUint(encoder2, written);
    for (let i = 0; i < written; i++) {
      write(encoder2, _strBuffer[i]);
    }
  } else {
    writeVarUint8Array(encoder2, encodeUtf8(str));
  }
};
var _writeVarStringPolyfill = (encoder2, str) => {
  const encodedString = unescape(encodeURIComponent(str));
  const len = encodedString.length;
  writeVarUint(encoder2, len);
  for (let i = 0; i < len; i++) {
    write(
      encoder2,
      /** @type {number} */
      encodedString.codePointAt(i)
    );
  }
};
var writeVarString = utf8TextEncoder && /** @type {any} */
utf8TextEncoder.encodeInto ? _writeVarStringNative : _writeVarStringPolyfill;
var writeUint8Array = (encoder2, uint8Array) => {
  const bufferLen = encoder2.cbuf.length;
  const cpos = encoder2.cpos;
  const leftCopyLen = min(bufferLen - cpos, uint8Array.length);
  const rightCopyLen = uint8Array.length - leftCopyLen;
  encoder2.cbuf.set(uint8Array.subarray(0, leftCopyLen), cpos);
  encoder2.cpos += leftCopyLen;
  if (rightCopyLen > 0) {
    encoder2.bufs.push(encoder2.cbuf);
    encoder2.cbuf = new Uint8Array(max(bufferLen * 2, rightCopyLen));
    encoder2.cbuf.set(uint8Array.subarray(leftCopyLen));
    encoder2.cpos = rightCopyLen;
  }
};
var writeVarUint8Array = (encoder2, uint8Array) => {
  writeVarUint(encoder2, uint8Array.byteLength);
  writeUint8Array(encoder2, uint8Array);
};
var writeOnDataView = (encoder2, len) => {
  verifyLen(encoder2, len);
  const dview = new DataView(encoder2.cbuf.buffer, encoder2.cpos, len);
  encoder2.cpos += len;
  return dview;
};
var writeFloat32 = (encoder2, num) => writeOnDataView(encoder2, 4).setFloat32(0, num, false);
var writeFloat64 = (encoder2, num) => writeOnDataView(encoder2, 8).setFloat64(0, num, false);
var writeBigInt64 = (encoder2, num) => (
  /** @type {any} */
  writeOnDataView(encoder2, 8).setBigInt64(0, num, false)
);
var floatTestBed = new DataView(new ArrayBuffer(4));
var isFloat32 = (num) => {
  floatTestBed.setFloat32(0, num);
  return floatTestBed.getFloat32(0) === num;
};
var writeAny = (encoder2, data) => {
  switch (typeof data) {
    case "string":
      write(encoder2, 119);
      writeVarString(encoder2, data);
      break;
    case "number":
      if (isInteger(data) && abs(data) <= BITS31) {
        write(encoder2, 125);
        writeVarInt(encoder2, data);
      } else if (isFloat32(data)) {
        write(encoder2, 124);
        writeFloat32(encoder2, data);
      } else {
        write(encoder2, 123);
        writeFloat64(encoder2, data);
      }
      break;
    case "bigint":
      write(encoder2, 122);
      writeBigInt64(encoder2, data);
      break;
    case "object":
      if (data === null) {
        write(encoder2, 126);
      } else if (isArray(data)) {
        write(encoder2, 117);
        writeVarUint(encoder2, data.length);
        for (let i = 0; i < data.length; i++) {
          writeAny(encoder2, data[i]);
        }
      } else if (data instanceof Uint8Array) {
        write(encoder2, 116);
        writeVarUint8Array(encoder2, data);
      } else {
        write(encoder2, 118);
        const keys2 = Object.keys(data);
        writeVarUint(encoder2, keys2.length);
        for (let i = 0; i < keys2.length; i++) {
          const key = keys2[i];
          writeVarString(encoder2, key);
          writeAny(encoder2, data[key]);
        }
      }
      break;
    case "boolean":
      write(encoder2, data ? 120 : 121);
      break;
    default:
      write(encoder2, 127);
  }
};
var RleEncoder = class extends Encoder {
  /**
   * @param {function(Encoder, T):void} writer
   */
  constructor(writer) {
    super();
    this.w = writer;
    this.s = null;
    this.count = 0;
  }
  /**
   * @param {T} v
   */
  write(v) {
    if (this.s === v) {
      this.count++;
    } else {
      if (this.count > 0) {
        writeVarUint(this, this.count - 1);
      }
      this.count = 1;
      this.w(this, v);
      this.s = v;
    }
  }
};
var flushUintOptRleEncoder = (encoder2) => {
  if (encoder2.count > 0) {
    writeVarInt(encoder2.encoder, encoder2.count === 1 ? encoder2.s : -encoder2.s);
    if (encoder2.count > 1) {
      writeVarUint(encoder2.encoder, encoder2.count - 2);
    }
  }
};
var UintOptRleEncoder = class {
  constructor() {
    this.encoder = new Encoder();
    this.s = 0;
    this.count = 0;
  }
  /**
   * @param {number} v
   */
  write(v) {
    if (this.s === v) {
      this.count++;
    } else {
      flushUintOptRleEncoder(this);
      this.count = 1;
      this.s = v;
    }
  }
  /**
   * Flush the encoded state and transform this to a Uint8Array.
   *
   * Note that this should only be called once.
   */
  toUint8Array() {
    flushUintOptRleEncoder(this);
    return toUint8Array(this.encoder);
  }
};
var flushIntDiffOptRleEncoder = (encoder2) => {
  if (encoder2.count > 0) {
    const encodedDiff = encoder2.diff * 2 + (encoder2.count === 1 ? 0 : 1);
    writeVarInt(encoder2.encoder, encodedDiff);
    if (encoder2.count > 1) {
      writeVarUint(encoder2.encoder, encoder2.count - 2);
    }
  }
};
var IntDiffOptRleEncoder = class {
  constructor() {
    this.encoder = new Encoder();
    this.s = 0;
    this.count = 0;
    this.diff = 0;
  }
  /**
   * @param {number} v
   */
  write(v) {
    if (this.diff === v - this.s) {
      this.s = v;
      this.count++;
    } else {
      flushIntDiffOptRleEncoder(this);
      this.count = 1;
      this.diff = v - this.s;
      this.s = v;
    }
  }
  /**
   * Flush the encoded state and transform this to a Uint8Array.
   *
   * Note that this should only be called once.
   */
  toUint8Array() {
    flushIntDiffOptRleEncoder(this);
    return toUint8Array(this.encoder);
  }
};
var StringEncoder = class {
  constructor() {
    this.sarr = [];
    this.s = "";
    this.lensE = new UintOptRleEncoder();
  }
  /**
   * @param {string} string
   */
  write(string) {
    this.s += string;
    if (this.s.length > 19) {
      this.sarr.push(this.s);
      this.s = "";
    }
    this.lensE.write(string.length);
  }
  toUint8Array() {
    const encoder2 = new Encoder();
    this.sarr.push(this.s);
    this.s = "";
    writeVarString(encoder2, this.sarr.join(""));
    writeUint8Array(encoder2, this.lensE.toUint8Array());
    return toUint8Array(encoder2);
  }
};

// node_modules/lib0/error.js
var create3 = (s) => new Error(s);
var methodUnimplemented = () => {
  throw create3("Method unimplemented");
};
var unexpectedCase = () => {
  throw create3("Unexpected case");
};

// node_modules/lib0/decoding.js
var errorUnexpectedEndOfArray = create3("Unexpected end of array");
var errorIntegerOutOfRange = create3("Integer out of Range");
var subarray = (arr, begin, len) => {
  if (begin < 0 || len < 0 || begin + len > arr.length) {
    throw errorUnexpectedEndOfArray;
  }
  return new Uint8Array(arr.buffer, arr.byteOffset + begin, len);
};
var subdataview = (arr, begin, len) => {
  if (begin < 0 || len < 0 || begin + len > arr.length) {
    throw errorUnexpectedEndOfArray;
  }
  return new DataView(arr.buffer, arr.byteOffset + begin, len);
};
var Decoder = class {
  /**
   * @param {Uint8Array<Buf>} uint8Array Binary data to decode
   */
  constructor(uint8Array) {
    this.arr = uint8Array;
    this.pos = 0;
  }
};
var createDecoder = (uint8Array) => new Decoder(uint8Array);
var hasContent = (decoder) => decoder.pos !== decoder.arr.length;
var readUint8Array = (decoder, len) => {
  const view = subarray(decoder.arr, decoder.pos, len);
  decoder.pos += len;
  return view;
};
var readVarUint8Array = (decoder) => readUint8Array(decoder, readVarUint(decoder));
var readUint8 = (decoder) => decoder.arr[decoder.pos++];
var readVarUint = (decoder) => {
  let num = 0;
  let mult = 1;
  const len = decoder.arr.length;
  while (decoder.pos < len) {
    const r = decoder.arr[decoder.pos++];
    num = num + (r & BITS7) * mult;
    mult *= 128;
    if (r < BIT8) {
      return num;
    }
    if (num > MAX_SAFE_INTEGER) {
      throw errorIntegerOutOfRange;
    }
  }
  throw errorUnexpectedEndOfArray;
};
var readVarInt = (decoder) => {
  let r = decoder.arr[decoder.pos++];
  let num = r & BITS6;
  let mult = 64;
  const sign = (r & BIT7) > 0 ? -1 : 1;
  if ((r & BIT8) === 0) {
    return sign * num;
  }
  const len = decoder.arr.length;
  while (decoder.pos < len) {
    r = decoder.arr[decoder.pos++];
    num = num + (r & BITS7) * mult;
    mult *= 128;
    if (r < BIT8) {
      return sign * num;
    }
    if (num > MAX_SAFE_INTEGER) {
      throw errorIntegerOutOfRange;
    }
  }
  throw errorUnexpectedEndOfArray;
};
var _readVarStringPolyfill = (decoder) => {
  let remainingLen = readVarUint(decoder);
  if (remainingLen === 0) {
    return "";
  } else {
    let encodedString = String.fromCodePoint(readUint8(decoder));
    if (--remainingLen < 100) {
      while (remainingLen--) {
        encodedString += String.fromCodePoint(readUint8(decoder));
      }
    } else {
      while (remainingLen > 0) {
        const nextLen = remainingLen < 1e4 ? remainingLen : 1e4;
        const bytes = decoder.arr.subarray(decoder.pos, decoder.pos + nextLen);
        decoder.pos += nextLen;
        encodedString += String.fromCodePoint.apply(
          null,
          /** @type {any} */
          bytes
        );
        remainingLen -= nextLen;
      }
    }
    return decodeURIComponent(escape(encodedString));
  }
};
var _readVarStringNative = (decoder) => (
  /** @type any */
  utf8TextDecoder.decode(readVarUint8Array(decoder))
);
var readVarString = utf8TextDecoder ? _readVarStringNative : _readVarStringPolyfill;
var readFromDataView = (decoder, len) => {
  const dv = subdataview(decoder.arr, decoder.pos, len);
  decoder.pos += len;
  return dv;
};
var readFloat32 = (decoder) => readFromDataView(decoder, 4).getFloat32(0, false);
var readFloat64 = (decoder) => readFromDataView(decoder, 8).getFloat64(0, false);
var readBigInt64 = (decoder) => (
  /** @type {any} */
  readFromDataView(decoder, 8).getBigInt64(0, false)
);
var readAnyLookupTable = [
  (decoder) => void 0,
  // CASE 127: undefined
  (decoder) => null,
  // CASE 126: null
  readVarInt,
  // CASE 125: integer
  readFloat32,
  // CASE 124: float32
  readFloat64,
  // CASE 123: float64
  readBigInt64,
  // CASE 122: bigint
  (decoder) => false,
  // CASE 121: boolean (false)
  (decoder) => true,
  // CASE 120: boolean (true)
  readVarString,
  // CASE 119: string
  (decoder) => {
    const len = readVarUint(decoder);
    const obj = {};
    for (let i = 0; i < len; i++) {
      const key = readVarString(decoder);
      obj[key] = readAny(decoder);
    }
    return obj;
  },
  (decoder) => {
    const len = readVarUint(decoder);
    const arr = [];
    for (let i = 0; i < len; i++) {
      arr.push(readAny(decoder));
    }
    return arr;
  },
  readVarUint8Array
  // CASE 116: Uint8Array
];
var readAny = (decoder) => readAnyLookupTable[127 - readUint8(decoder)](decoder);
var RleDecoder = class extends Decoder {
  /**
   * @param {Uint8Array} uint8Array
   * @param {function(Decoder):T} reader
   */
  constructor(uint8Array, reader) {
    super(uint8Array);
    this.reader = reader;
    this.s = null;
    this.count = 0;
  }
  read() {
    if (this.count === 0) {
      this.s = this.reader(this);
      if (hasContent(this)) {
        this.count = readVarUint(this) + 1;
      } else {
        this.count = -1;
      }
    }
    this.count--;
    return (
      /** @type {T} */
      this.s
    );
  }
};
var UintOptRleDecoder = class extends Decoder {
  /**
   * @param {Uint8Array} uint8Array
   */
  constructor(uint8Array) {
    super(uint8Array);
    this.s = 0;
    this.count = 0;
  }
  read() {
    if (this.count === 0) {
      this.s = readVarInt(this);
      const isNegative = isNegativeZero(this.s);
      this.count = 1;
      if (isNegative) {
        this.s = -this.s;
        this.count = readVarUint(this) + 2;
      }
    }
    this.count--;
    return (
      /** @type {number} */
      this.s
    );
  }
};
var IntDiffOptRleDecoder = class extends Decoder {
  /**
   * @param {Uint8Array} uint8Array
   */
  constructor(uint8Array) {
    super(uint8Array);
    this.s = 0;
    this.count = 0;
    this.diff = 0;
  }
  /**
   * @return {number}
   */
  read() {
    if (this.count === 0) {
      const diff = readVarInt(this);
      const hasCount = diff & 1;
      this.diff = floor(diff / 2);
      this.count = 1;
      if (hasCount) {
        this.count = readVarUint(this) + 2;
      }
    }
    this.s += this.diff;
    this.count--;
    return this.s;
  }
};
var StringDecoder = class {
  /**
   * @param {Uint8Array} uint8Array
   */
  constructor(uint8Array) {
    this.decoder = new UintOptRleDecoder(uint8Array);
    this.str = readVarString(this.decoder);
    this.spos = 0;
  }
  /**
   * @return {string}
   */
  read() {
    const end = this.spos + this.decoder.read();
    const res = this.str.slice(this.spos, end);
    this.spos = end;
    return res;
  }
};

// node_modules/lib0/webcrypto.js
var subtle = crypto.subtle;
var getRandomValues = crypto.getRandomValues.bind(crypto);

// node_modules/lib0/random.js
var uint32 = () => getRandomValues(new Uint32Array(1))[0];
var uuidv4Template = "10000000-1000-4000-8000" + -1e11;
var uuidv4 = () => uuidv4Template.replace(
  /[018]/g,
  /** @param {number} c */
  (c) => (c ^ uint32() & 15 >> c / 4).toString(16)
);

// node_modules/lib0/time.js
var getUnixTime = Date.now;

// node_modules/lib0/promise.js
var create4 = (f) => (
  /** @type {Promise<T>} */
  new Promise(f)
);
var all = Promise.all.bind(Promise);

// node_modules/lib0/conditions.js
var undefinedToNull = (v) => v === void 0 ? null : v;

// node_modules/lib0/storage.js
var VarStoragePolyfill = class {
  constructor() {
    this.map = /* @__PURE__ */ new Map();
  }
  /**
   * @param {string} key
   * @param {any} newValue
   */
  setItem(key, newValue) {
    this.map.set(key, newValue);
  }
  /**
   * @param {string} key
   */
  getItem(key) {
    return this.map.get(key);
  }
};
var _localStorage = new VarStoragePolyfill();
var usePolyfill = true;
try {
  if (typeof localStorage !== "undefined" && localStorage) {
    _localStorage = localStorage;
    usePolyfill = false;
  }
} catch (e) {
}
var varStorage = _localStorage;

// node_modules/lib0/trait/equality.js
var EqualityTraitSymbol = /* @__PURE__ */ Symbol("Equality");
var equals = (a, b) => a === b || !!a?.[EqualityTraitSymbol]?.(b) || false;

// node_modules/lib0/object.js
var isObject = (o) => typeof o === "object";
var assign = Object.assign;
var keys = Object.keys;
var forEach = (obj, f) => {
  for (const key in obj) {
    f(obj[key], key);
  }
};
var size = (obj) => keys(obj).length;
var isEmpty = (obj) => {
  for (const _k in obj) {
    return false;
  }
  return true;
};
var every2 = (obj, f) => {
  for (const key in obj) {
    if (!f(obj[key], key)) {
      return false;
    }
  }
  return true;
};
var hasProperty = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
var equalFlat = (a, b) => a === b || size(a) === size(b) && every2(a, (val, key) => (val !== void 0 || hasProperty(b, key)) && equals(b[key], val));
var freeze = Object.freeze;
var deepFreeze = (o) => {
  for (const key in o) {
    const c = o[key];
    if (typeof c === "object" || typeof c === "function") {
      deepFreeze(o[key]);
    }
  }
  return freeze(o);
};

// node_modules/lib0/function.js
var callAll = (fs, args2, i = 0) => {
  try {
    for (; i < fs.length; i++) {
      fs[i](...args2);
    }
  } finally {
    if (i < fs.length) {
      callAll(fs, args2, i + 1);
    }
  }
};
var id = (a) => a;
var equalityDeep = (a, b) => {
  if (a === b) {
    return true;
  }
  if (a == null || b == null || a.constructor !== b.constructor && (a.constructor || Object) !== (b.constructor || Object)) {
    return false;
  }
  if (a[EqualityTraitSymbol] != null) {
    return a[EqualityTraitSymbol](b);
  }
  switch (a.constructor) {
    case ArrayBuffer:
      a = new Uint8Array(a);
      b = new Uint8Array(b);
    // eslint-disable-next-line no-fallthrough
    case Uint8Array: {
      if (a.byteLength !== b.byteLength) {
        return false;
      }
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
          return false;
        }
      }
      break;
    }
    case Set: {
      if (a.size !== b.size) {
        return false;
      }
      for (const value of a) {
        if (!b.has(value)) {
          return false;
        }
      }
      break;
    }
    case Map: {
      if (a.size !== b.size) {
        return false;
      }
      for (const key of a.keys()) {
        if (!b.has(key) || !equalityDeep(a.get(key), b.get(key))) {
          return false;
        }
      }
      break;
    }
    case void 0:
    case Object:
      if (size(a) !== size(b)) {
        return false;
      }
      for (const key in a) {
        if (!hasProperty(a, key) || !equalityDeep(a[key], b[key])) {
          return false;
        }
      }
      break;
    case Array:
      if (a.length !== b.length) {
        return false;
      }
      for (let i = 0; i < a.length; i++) {
        if (!equalityDeep(a[i], b[i])) {
          return false;
        }
      }
      break;
    default:
      return false;
  }
  return true;
};
var isOneOf = (value, options) => options.includes(value);

// node_modules/lib0/environment.js
var isNode = typeof process !== "undefined" && process.release && /node|io\.js/.test(process.release.name) && Object.prototype.toString.call(typeof process !== "undefined" ? process : 0) === "[object process]";
var isMac = typeof navigator !== "undefined" ? /Mac/.test(navigator.platform) : false;
var params;
var args = [];
var computeParams = () => {
  if (params === void 0) {
    if (isNode) {
      params = create();
      const pargs = process.argv;
      let currParamName = null;
      for (let i = 0; i < pargs.length; i++) {
        const parg = pargs[i];
        if (parg[0] === "-") {
          if (currParamName !== null) {
            params.set(currParamName, "");
          }
          currParamName = parg;
        } else {
          if (currParamName !== null) {
            params.set(currParamName, parg);
            currParamName = null;
          } else {
            args.push(parg);
          }
        }
      }
      if (currParamName !== null) {
        params.set(currParamName, "");
      }
    } else if (typeof location === "object") {
      params = create();
      (location.search || "?").slice(1).split("&").forEach((kv) => {
        if (kv.length !== 0) {
          const [key, value] = kv.split("=");
          params.set(`--${fromCamelCase(key, "-")}`, value);
          params.set(`-${fromCamelCase(key, "-")}`, value);
        }
      });
    } else {
      params = create();
    }
  }
  return params;
};
var hasParam = (name) => computeParams().has(name);
var getVariable = (name) => isNode ? undefinedToNull(process.env[name.toUpperCase().replaceAll("-", "_")]) : undefinedToNull(varStorage.getItem(name));
var hasConf = (name) => hasParam("--" + name) || getVariable(name) !== null;
var production = hasConf("production");
var forceColor = isNode && isOneOf(process.env.FORCE_COLOR, ["true", "1", "2"]);
var supportsColor = forceColor || !hasParam("--no-colors") && // @todo deprecate --no-colors
!hasConf("no-color") && (!isNode || process.stdout.isTTY) && (!isNode || hasParam("--color") || getVariable("COLORTERM") !== null || (getVariable("TERM") || "").includes("color"));

// node_modules/lib0/buffer.js
var createUint8ArrayFromLen = (len) => new Uint8Array(len);
var copyUint8Array = (uint8Array) => {
  const newBuf = createUint8ArrayFromLen(uint8Array.byteLength);
  newBuf.set(uint8Array);
  return newBuf;
};

// node_modules/lib0/pair.js
var Pair = class {
  /**
   * @param {L} left
   * @param {R} right
   */
  constructor(left, right) {
    this.left = left;
    this.right = right;
  }
};
var create5 = (left, right) => new Pair(left, right);

// node_modules/lib0/prng.js
var bool = (gen) => gen.next() >= 0.5;
var int53 = (gen, min2, max2) => floor(gen.next() * (max2 + 1 - min2) + min2);
var int32 = (gen, min2, max2) => floor(gen.next() * (max2 + 1 - min2) + min2);
var int31 = (gen, min2, max2) => int32(gen, min2, max2);
var letter = (gen) => fromCharCode(int31(gen, 97, 122));
var word = (gen, minLen = 0, maxLen = 20) => {
  const len = int31(gen, minLen, maxLen);
  let str = "";
  for (let i = 0; i < len; i++) {
    str += letter(gen);
  }
  return str;
};
var oneOf = (gen, array) => array[int31(gen, 0, array.length - 1)];

// node_modules/lib0/schema.js
var schemaSymbol = /* @__PURE__ */ Symbol("0schema");
var ValidationError = class {
  constructor() {
    this._rerrs = [];
  }
  /**
   * @param {string?} path
   * @param {string} expected
   * @param {string} has
   * @param {string?} message
   */
  extend(path, expected, has, message = null) {
    this._rerrs.push({ path, expected, has, message });
  }
  toString() {
    const s = [];
    for (let i = this._rerrs.length - 1; i > 0; i--) {
      const r = this._rerrs[i];
      s.push(repeat(" ", (this._rerrs.length - i) * 2) + `${r.path != null ? `[${r.path}] ` : ""}${r.has} doesn't match ${r.expected}. ${r.message}`);
    }
    return s.join("\n");
  }
};
var shapeExtends = (a, b) => {
  if (a === b) return true;
  if (a == null || b == null || a.constructor !== b.constructor) return false;
  if (a[EqualityTraitSymbol]) return equals(a, b);
  if (isArray(a)) {
    return every(
      a,
      (aitem) => some(b, (bitem) => shapeExtends(aitem, bitem))
    );
  } else if (isObject(a)) {
    return every2(
      a,
      (aitem, akey) => shapeExtends(aitem, b[akey])
    );
  }
  return false;
};
var Schema = class {
  /**
   * @param {Schema<any>} other
   */
  extends(other) {
    let [a, b] = [
      /** @type {any} */
      this.shape,
      /** @type {any} */
      other.shape
    ];
    if (
      /** @type {typeof Schema<any>} */
      this.constructor._dilutes
    ) [b, a] = [a, b];
    return shapeExtends(a, b);
  }
  /**
   * Overwrite this when necessary. By default, we only check the `shape` property which every shape
   * should have.
   * @param {Schema<any>} other
   */
  equals(other) {
    return this.constructor === other.constructor && equalityDeep(this.shape, other.shape);
  }
  [schemaSymbol]() {
    return true;
  }
  /**
   * @param {object} other
   */
  [EqualityTraitSymbol](other) {
    return this.equals(
      /** @type {any} */
      other
    );
  }
  /**
   * Use `schema.validate(obj)` with a typed parameter that is already of typed to be an instance of
   * Schema. Validate will check the structure of the parameter and return true iff the instance
   * really is an instance of Schema.
   *
   * @param {T} o
   * @return {boolean}
   */
  validate(o) {
    return this.check(o);
  }
  /* c8 ignore start */
  /**
   * Similar to validate, but this method accepts untyped parameters.
   *
   * @param {any} _o
   * @param {ValidationError} [_err]
   * @return {_o is T}
   */
  check(_o, _err) {
    methodUnimplemented();
  }
  /* c8 ignore stop */
  /**
   * @type {Schema<T?>}
   */
  get nullable() {
    return $union(this, $null);
  }
  /**
   * @type {$Optional<Schema<T>>}
   */
  get optional() {
    return new $Optional(
      /** @type {Schema<T>} */
      this
    );
  }
  /**
   * Cast a variable to a specific type. Returns the casted value, or throws an exception otherwise.
   * Use this if you know that the type is of a specific type and you just want to convince the type
   * system.
   *
   * **Do not rely on these error messages!**
   * Performs an assertion check only if not in a production environment.
   *
   * @template OO
   * @param {OO} o
   * @return {Extract<OO, T> extends never ? T : (OO extends Array<never> ? T : Extract<OO,T>)}
   */
  cast(o) {
    assert(o, this);
    return (
      /** @type {any} */
      o
    );
  }
  /**
   * EXPECTO PATRONUM!! 🪄
   * This function protects against type errors. Though it may not work in the real world.
   *
   * "After all this time?"
   * "Always." - Snape, talking about type safety
   *
   * Ensures that a variable is a a specific type. Returns the value, or throws an exception if the assertion check failed.
   * Use this if you know that the type is of a specific type and you just want to convince the type
   * system.
   *
   * Can be useful when defining lambdas: `s.lambda(s.$number, s.$void).expect((n) => n + 1)`
   *
   * **Do not rely on these error messages!**
   * Performs an assertion check if not in a production environment.
   *
   * @param {T} o
   * @return {o extends T ? T : never}
   */
  expect(o) {
    assert(o, this);
    return o;
  }
};
// this.shape must not be defined on Schema. Otherwise typecheck on metatypes (e.g. $$object) won't work as expected anymore
/**
 * If true, the more things are added to the shape the more objects this schema will accept (e.g.
 * union). By default, the more objects are added, the the fewer objects this schema will accept.
 * @protected
 */
__publicField(Schema, "_dilutes", false);
var $ConstructedBy = class extends Schema {
  /**
   * @param {C} c
   * @param {((o:Instance<C>)=>boolean)|null} check
   */
  constructor(c, check) {
    super();
    this.shape = c;
    this._c = check;
  }
  /**
   * @param {any} o
   * @param {ValidationError} [err]
   * @return {o is C extends ((...args:any[]) => infer T) ? T : (C extends (new (...args:any[]) => any) ? InstanceType<C> : never)} o
   */
  check(o, err = void 0) {
    const c = o?.constructor === this.shape && (this._c == null || this._c(o));
    !c && err?.extend(null, this.shape.name, o?.constructor.name, o?.constructor !== this.shape ? "Constructor match failed" : "Check failed");
    return c;
  }
};
var $constructedBy = (c, check = null) => new $ConstructedBy(c, check);
var $$constructedBy = $constructedBy($ConstructedBy);
var $Custom = class extends Schema {
  /**
   * @param {(o:any) => boolean} check
   */
  constructor(check) {
    super();
    this.shape = check;
  }
  /**
   * @param {any} o
   * @param {ValidationError} err
   * @return {o is any}
   */
  check(o, err) {
    const c = this.shape(o);
    !c && err?.extend(null, "custom prop", o?.constructor.name, "failed to check custom prop");
    return c;
  }
};
var $custom = (check) => new $Custom(check);
var $$custom = $constructedBy($Custom);
var $Literal = class extends Schema {
  /**
   * @param {Array<T>} literals
   */
  constructor(literals) {
    super();
    this.shape = literals;
  }
  /**
   *
   * @param {any} o
   * @param {ValidationError} [err]
   * @return {o is T}
   */
  check(o, err) {
    const c = this.shape.some((a) => a === o);
    !c && err?.extend(null, this.shape.join(" | "), o.toString());
    return c;
  }
};
var $literal = (...literals) => new $Literal(literals);
var $$literal = $constructedBy($Literal);
var _regexEscape = (
  /** @type {any} */
  RegExp.escape || /** @type {(str:string) => string} */
  ((str) => str.replace(/[().|&,$^[\]]/g, (s) => "\\" + s))
);
var _schemaStringTemplateToRegex = (s) => {
  if ($string.check(s)) {
    return [_regexEscape(s)];
  }
  if ($$literal.check(s)) {
    return (
      /** @type {Array<string|number>} */
      s.shape.map((v) => v + "")
    );
  }
  if ($$number.check(s)) {
    return ["[+-]?\\d+.?\\d*"];
  }
  if ($$string.check(s)) {
    return [".*"];
  }
  if ($$union.check(s)) {
    return s.shape.map(_schemaStringTemplateToRegex).flat(1);
  }
  unexpectedCase();
};
var $StringTemplate = class extends Schema {
  /**
   * @param {T} shape
   */
  constructor(shape) {
    super();
    this.shape = shape;
    this._r = new RegExp("^" + shape.map(_schemaStringTemplateToRegex).map((opts) => `(${opts.join("|")})`).join("") + "$");
  }
  /**
   * @param {any} o
   * @param {ValidationError} [err]
   * @return {o is CastStringTemplateArgsToTemplate<T>}
   */
  check(o, err) {
    const c = this._r.exec(o) != null;
    !c && err?.extend(null, this._r.toString(), o.toString(), "String doesn't match string template.");
    return c;
  }
};
var $$stringTemplate = $constructedBy($StringTemplate);
var isOptionalSymbol = /* @__PURE__ */ Symbol("optional");
var $Optional = class extends Schema {
  /**
   * @param {S} shape
   */
  constructor(shape) {
    super();
    this.shape = shape;
  }
  /**
   * @param {any} o
   * @param {ValidationError} [err]
   * @return {o is (Unwrap<S>|undefined)}
   */
  check(o, err) {
    const c = o === void 0 || this.shape.check(o);
    !c && err?.extend(null, "undefined (optional)", "()");
    return c;
  }
  get [isOptionalSymbol]() {
    return true;
  }
};
var $$optional = $constructedBy($Optional);
var $Never = class extends Schema {
  /**
   * @param {any} _o
   * @param {ValidationError} [err]
   * @return {_o is never}
   */
  check(_o, err) {
    err?.extend(null, "never", typeof _o);
    return false;
  }
};
var $never = new $Never();
var $$never = $constructedBy($Never);
var _$Object = class _$Object extends Schema {
  /**
   * @param {S} shape
   * @param {boolean} partial
   */
  constructor(shape, partial = false) {
    super();
    this.shape = shape;
    this._isPartial = partial;
  }
  /**
   * @type {Schema<Partial<$ObjectToType<S>>>}
   */
  get partial() {
    return new _$Object(this.shape, true);
  }
  /**
   * @param {any} o
   * @param {ValidationError} err
   * @return {o is $ObjectToType<S>}
   */
  check(o, err) {
    if (o == null) {
      err?.extend(null, "object", "null");
      return false;
    }
    return every2(this.shape, (vv, vk) => {
      const c = this._isPartial && !hasProperty(o, vk) || vv.check(o[vk], err);
      !c && err?.extend(vk.toString(), vv.toString(), typeof o[vk], "Object property does not match");
      return c;
    });
  }
};
__publicField(_$Object, "_dilutes", true);
var $Object = _$Object;
var $object = (def) => (
  /** @type {any} */
  new $Object(def)
);
var $$object = $constructedBy($Object);
var $objectAny = $custom((o) => o != null && (o.constructor === Object || o.constructor == null));
var $Record = class extends Schema {
  /**
   * @param {Keys} keys
   * @param {Values} values
   */
  constructor(keys2, values) {
    super();
    this.shape = {
      keys: keys2,
      values
    };
  }
  /**
   * @param {any} o
   * @param {ValidationError} err
   * @return {o is { [key in Unwrap<Keys>]: Unwrap<Values> }}
   */
  check(o, err) {
    return o != null && every2(o, (vv, vk) => {
      const ck = this.shape.keys.check(vk, err);
      !ck && err?.extend(vk + "", "Record", typeof o, ck ? "Key doesn't match schema" : "Value doesn't match value");
      return ck && this.shape.values.check(vv, err);
    });
  }
};
var $record = (keys2, values) => new $Record(keys2, values);
var $$record = $constructedBy($Record);
var $Tuple = class extends Schema {
  /**
   * @param {S} shape
   */
  constructor(shape) {
    super();
    this.shape = shape;
  }
  /**
   * @param {any} o
   * @param {ValidationError} err
   * @return {o is { [K in keyof S]: S[K] extends Schema<infer Type> ? Type : never }}
   */
  check(o, err) {
    return o != null && every2(this.shape, (vv, vk) => {
      const c = (
        /** @type {Schema<any>} */
        vv.check(o[vk], err)
      );
      !c && err?.extend(vk.toString(), "Tuple", typeof vv);
      return c;
    });
  }
};
var $tuple = (...def) => new $Tuple(def);
var $$tuple = $constructedBy($Tuple);
var $Array = class extends Schema {
  /**
   * @param {Array<S>} v
   */
  constructor(v) {
    super();
    this.shape = v.length === 1 ? v[0] : new $Union(v);
  }
  /**
   * @param {any} o
   * @param {ValidationError} [err]
   * @return {o is Array<S extends Schema<infer T> ? T : never>} o
   */
  check(o, err) {
    const c = isArray(o) && every(o, (oi) => this.shape.check(oi));
    !c && err?.extend(null, "Array", "");
    return c;
  }
};
var $array = (...def) => new $Array(def);
var $$array = $constructedBy($Array);
var $arrayAny = $custom((o) => isArray(o));
var $InstanceOf = class extends Schema {
  /**
   * @param {new (...args:any) => T} constructor
   * @param {((o:T) => boolean)|null} check
   */
  constructor(constructor, check) {
    super();
    this.shape = constructor;
    this._c = check;
  }
  /**
   * @param {any} o
   * @param {ValidationError} err
   * @return {o is T}
   */
  check(o, err) {
    const c = o instanceof this.shape && (this._c == null || this._c(o));
    !c && err?.extend(null, this.shape.name, o?.constructor.name);
    return c;
  }
};
var $instanceOf = (c, check = null) => new $InstanceOf(c, check);
var $$instanceOf = $constructedBy($InstanceOf);
var $$schema = $instanceOf(Schema);
var $Lambda = class extends Schema {
  /**
   * @param {Args} args
   */
  constructor(args2) {
    super();
    this.len = args2.length - 1;
    this.args = $tuple(...args2.slice(-1));
    this.res = args2[this.len];
  }
  /**
   * @param {any} f
   * @param {ValidationError} err
   * @return {f is _LArgsToLambdaDef<Args>}
   */
  check(f, err) {
    const c = f.constructor === Function && f.length <= this.len;
    !c && err?.extend(null, "function", typeof f);
    return c;
  }
};
var $$lambda = $constructedBy($Lambda);
var $function = $custom((o) => typeof o === "function");
var $Intersection = class extends Schema {
  /**
   * @param {T} v
   */
  constructor(v) {
    super();
    this.shape = v;
  }
  /**
   * @param {any} o
   * @param {ValidationError} [err]
   * @return {o is Intersect<UnwrapArray<T>>}
   */
  check(o, err) {
    const c = every(this.shape, (check) => check.check(o, err));
    !c && err?.extend(null, "Intersectinon", typeof o);
    return c;
  }
};
var $$intersect = $constructedBy($Intersection, (o) => o.shape.length > 0);
var $Union = class extends Schema {
  /**
   * @param {Array<Schema<S>>} v
   */
  constructor(v) {
    super();
    this.shape = v;
  }
  /**
   * @param {any} o
   * @param {ValidationError} [err]
   * @return {o is S}
   */
  check(o, err) {
    const c = some(this.shape, (vv) => vv.check(o, err));
    err?.extend(null, "Union", typeof o);
    return c;
  }
};
__publicField($Union, "_dilutes", true);
var $union = (...schemas) => schemas.findIndex(($s) => $$union.check($s)) >= 0 ? $union(...schemas.map(($s) => $($s)).map(($s) => $$union.check($s) ? $s.shape : [$s]).flat(1)) : schemas.length === 1 ? schemas[0] : new $Union(schemas);
var $$union = (
  /** @type {Schema<$Union<any>>} */
  $constructedBy($Union)
);
var _t = () => true;
var $any = $custom(_t);
var $$any = (
  /** @type {Schema<Schema<any>>} */
  $constructedBy($Custom, (o) => o.shape === _t)
);
var $bigint = $custom((o) => typeof o === "bigint");
var $$bigint = (
  /** @type {Schema<Schema<BigInt>>} */
  $custom((o) => o === $bigint)
);
var $symbol = $custom((o) => typeof o === "symbol");
var $$symbol = (
  /** @type {Schema<Schema<Symbol>>} */
  $custom((o) => o === $symbol)
);
var $number = $custom((o) => typeof o === "number");
var $$number = (
  /** @type {Schema<Schema<number>>} */
  $custom((o) => o === $number)
);
var $string = $custom((o) => typeof o === "string");
var $$string = (
  /** @type {Schema<Schema<string>>} */
  $custom((o) => o === $string)
);
var $boolean = $custom((o) => typeof o === "boolean");
var $$boolean = (
  /** @type {Schema<Schema<Boolean>>} */
  $custom((o) => o === $boolean)
);
var $undefined = $literal(void 0);
var $$undefined = (
  /** @type {Schema<Schema<undefined>>} */
  $constructedBy($Literal, (o) => o.shape.length === 1 && o.shape[0] === void 0)
);
var $void = $literal(void 0);
var $null = $literal(null);
var $$null = (
  /** @type {Schema<Schema<null>>} */
  $constructedBy($Literal, (o) => o.shape.length === 1 && o.shape[0] === null)
);
var $uint8Array = $constructedBy(Uint8Array);
var $$uint8Array = (
  /** @type {Schema<Schema<Uint8Array>>} */
  $constructedBy($ConstructedBy, (o) => o.shape === Uint8Array)
);
var $primitive = $union($number, $string, $null, $undefined, $bigint, $boolean, $symbol);
var $json = (() => {
  const $jsonArr = (
    /** @type {$Array<$any>} */
    $array($any)
  );
  const $jsonRecord = (
    /** @type {$Record<$string,$any>} */
    $record($string, $any)
  );
  const $json2 = $union($number, $string, $null, $boolean, $jsonArr, $jsonRecord);
  $jsonArr.shape = $json2;
  $jsonRecord.shape.values = $json2;
  return $json2;
})();
var $ = (o) => {
  if ($$schema.check(o)) {
    return (
      /** @type {any} */
      o
    );
  } else if ($objectAny.check(o)) {
    const o2 = {};
    for (const k in o) {
      o2[k] = $(o[k]);
    }
    return (
      /** @type {any} */
      $object(o2)
    );
  } else if ($arrayAny.check(o)) {
    return (
      /** @type {any} */
      $union(...o.map($))
    );
  } else if ($primitive.check(o)) {
    return (
      /** @type {any} */
      $literal(o)
    );
  } else if ($function.check(o)) {
    return (
      /** @type {any} */
      $constructedBy(
        /** @type {any} */
        o
      )
    );
  }
  unexpectedCase();
};
var assert = production ? () => {
} : (o, schema) => {
  const err = new ValidationError();
  if (!schema.check(o, err)) {
    throw create3(`Expected value to be of type ${schema.constructor.name}.
${err.toString()}`);
  }
};
var PatternMatcher = class {
  /**
   * @param {Schema<State>} [$state]
   */
  constructor($state) {
    this.patterns = [];
    this.$state = $state;
  }
  /**
   * @template P
   * @template R
   * @param {P} pattern
   * @param {(o:NoInfer<Unwrap<ReadSchema<P>>>,s:State)=>R} handler
   * @return {PatternMatcher<State,Patterns|Pattern<Unwrap<ReadSchema<P>>,R>>}
   */
  if(pattern, handler) {
    this.patterns.push({ if: $(pattern), h: handler });
    return this;
  }
  /**
   * @template R
   * @param {(o:any,s:State)=>R} h
   */
  else(h) {
    return this.if($any, h);
  }
  /**
   * @return {State extends undefined
   *   ? <In extends Unwrap<Patterns['if']>>(o:In,state?:undefined)=>PatternMatchResult<Patterns,In>
   *   : <In extends Unwrap<Patterns['if']>>(o:In,state:State)=>PatternMatchResult<Patterns,In>}
   */
  done() {
    return (
      /** @type {any} */
      (o, s) => {
        for (let i = 0; i < this.patterns.length; i++) {
          const p = this.patterns[i];
          if (p.if.check(o)) {
            return p.h(o, s);
          }
        }
        throw create3("Unhandled pattern");
      }
    );
  }
};
var match = (state) => new PatternMatcher(
  /** @type {any} */
  state
);
var _random = (
  /** @type {any} */
  match(
    /** @type {Schema<prng.PRNG>} */
    $any
  ).if($$number, (_o, gen) => int53(gen, MIN_SAFE_INTEGER, MAX_SAFE_INTEGER)).if($$string, (_o, gen) => word(gen)).if($$boolean, (_o, gen) => bool(gen)).if($$bigint, (_o, gen) => BigInt(int53(gen, MIN_SAFE_INTEGER, MAX_SAFE_INTEGER))).if($$union, (o, gen) => random(gen, oneOf(gen, o.shape))).if($$object, (o, gen) => {
    const res = {};
    for (const k in o.shape) {
      let prop = o.shape[k];
      if ($$optional.check(prop)) {
        if (bool(gen)) {
          continue;
        }
        prop = prop.shape;
      }
      res[k] = _random(prop, gen);
    }
    return res;
  }).if($$array, (o, gen) => {
    const arr = [];
    const n = int32(gen, 0, 42);
    for (let i = 0; i < n; i++) {
      arr.push(random(gen, o.shape));
    }
    return arr;
  }).if($$literal, (o, gen) => {
    return oneOf(gen, o.shape);
  }).if($$null, (o, gen) => {
    return null;
  }).if($$lambda, (o, gen) => {
    const res = random(gen, o.res);
    return () => res;
  }).if($$any, (o, gen) => random(gen, oneOf(gen, [
    $number,
    $string,
    $null,
    $undefined,
    $bigint,
    $boolean,
    $array($number),
    $record($union("a", "b", "c"), $number)
  ]))).if($$record, (o, gen) => {
    const res = {};
    const keysN = int53(gen, 0, 3);
    for (let i = 0; i < keysN; i++) {
      const key = random(gen, o.shape.keys);
      const val = random(gen, o.shape.values);
      res[key] = val;
    }
    return res;
  }).done()
);
var random = (gen, schema) => (
  /** @type {any} */
  _random($(schema), gen)
);

// node_modules/lib0/dom.js
var doc = (
  /** @type {Document} */
  typeof document !== "undefined" ? document : {}
);
var $fragment = $custom((el) => el.nodeType === DOCUMENT_FRAGMENT_NODE);
var domParser = (
  /** @type {DOMParser} */
  typeof DOMParser !== "undefined" ? new DOMParser() : null
);
var $element = $custom((el) => el.nodeType === ELEMENT_NODE);
var $text = $custom((el) => el.nodeType === TEXT_NODE);
var mapToStyleString = (m) => map(m, (value, key) => `${key}:${value};`).join("");
var ELEMENT_NODE = doc.ELEMENT_NODE;
var TEXT_NODE = doc.TEXT_NODE;
var CDATA_SECTION_NODE = doc.CDATA_SECTION_NODE;
var COMMENT_NODE = doc.COMMENT_NODE;
var DOCUMENT_NODE = doc.DOCUMENT_NODE;
var DOCUMENT_TYPE_NODE = doc.DOCUMENT_TYPE_NODE;
var DOCUMENT_FRAGMENT_NODE = doc.DOCUMENT_FRAGMENT_NODE;
var $node = $custom((el) => el.nodeType === DOCUMENT_NODE);

// node_modules/lib0/symbol.js
var create6 = Symbol;

// node_modules/lib0/logging.common.js
var BOLD = create6();
var UNBOLD = create6();
var BLUE = create6();
var GREY = create6();
var GREEN = create6();
var RED = create6();
var PURPLE = create6();
var ORANGE = create6();
var UNCOLOR = create6();
var computeNoColorLoggingArgs = (args2) => {
  if (args2.length === 1 && args2[0]?.constructor === Function) {
    args2 = /** @type {Array<string|Symbol|Object|number>} */
    /** @type {[function]} */
    args2[0]();
  }
  const strBuilder = [];
  const logArgs = [];
  let i = 0;
  for (; i < args2.length; i++) {
    const arg = args2[i];
    if (arg === void 0) {
      break;
    } else if (arg.constructor === String || arg.constructor === Number) {
      strBuilder.push(arg);
    } else if (arg.constructor === Object) {
      break;
    }
  }
  if (i > 0) {
    logArgs.push(strBuilder.join(""));
  }
  for (; i < args2.length; i++) {
    const arg = args2[i];
    if (!(arg instanceof Symbol)) {
      logArgs.push(arg);
    }
  }
  return logArgs;
};
var lastLoggingTime = getUnixTime();

// node_modules/lib0/logging.js
var _browserStyleMap = {
  [BOLD]: create5("font-weight", "bold"),
  [UNBOLD]: create5("font-weight", "normal"),
  [BLUE]: create5("color", "blue"),
  [GREEN]: create5("color", "green"),
  [GREY]: create5("color", "grey"),
  [RED]: create5("color", "red"),
  [PURPLE]: create5("color", "purple"),
  [ORANGE]: create5("color", "orange"),
  // not well supported in chrome when debugging node with inspector - TODO: deprecate
  [UNCOLOR]: create5("color", "black")
};
var computeBrowserLoggingArgs = (args2) => {
  if (args2.length === 1 && args2[0]?.constructor === Function) {
    args2 = /** @type {Array<string|Symbol|Object|number>} */
    /** @type {[function]} */
    args2[0]();
  }
  const strBuilder = [];
  const styles = [];
  const currentStyle = create();
  let logArgs = [];
  let i = 0;
  for (; i < args2.length; i++) {
    const arg = args2[i];
    const style = _browserStyleMap[arg];
    if (style !== void 0) {
      currentStyle.set(style.left, style.right);
    } else {
      if (arg === void 0) {
        break;
      }
      if (arg.constructor === String || arg.constructor === Number) {
        const style2 = mapToStyleString(currentStyle);
        if (i > 0 || style2.length > 0) {
          strBuilder.push("%c" + arg);
          styles.push(style2);
        } else {
          strBuilder.push(arg);
        }
      } else {
        break;
      }
    }
  }
  if (i > 0) {
    logArgs = styles;
    logArgs.unshift(strBuilder.join(""));
  }
  for (; i < args2.length; i++) {
    const arg = args2[i];
    if (!(arg instanceof Symbol)) {
      logArgs.push(arg);
    }
  }
  return logArgs;
};
var computeLoggingArgs = supportsColor ? computeBrowserLoggingArgs : computeNoColorLoggingArgs;
var print = (...args2) => {
  console.log(...computeLoggingArgs(args2));
  vconsoles.forEach((vc) => vc.print(args2));
};
var warn = (...args2) => {
  console.warn(...computeLoggingArgs(args2));
  args2.unshift(ORANGE);
  vconsoles.forEach((vc) => vc.print(args2));
};
var vconsoles = create2();

// node_modules/lib0/iterator.js
var createIterator = (next) => ({
  /**
   * @return {IterableIterator<T>}
   */
  [Symbol.iterator]() {
    return this;
  },
  // @ts-ignore
  next
});
var iteratorFilter = (iterator, filter) => createIterator(() => {
  let res;
  do {
    res = iterator.next();
  } while (!res.done && !filter(res.value));
  return res;
});
var iteratorMap = (iterator, fmap) => createIterator(() => {
  const { done, value } = iterator.next();
  return { done, value: done ? void 0 : fmap(value) };
});

// node_modules/yjs/dist/yjs.mjs
var DeleteItem = class {
  /**
   * @param {number} clock
   * @param {number} len
   */
  constructor(clock, len) {
    this.clock = clock;
    this.len = len;
  }
};
var DeleteSet = class {
  constructor() {
    this.clients = /* @__PURE__ */ new Map();
  }
};
var iterateDeletedStructs = (transaction, ds, f) => ds.clients.forEach((deletes, clientid) => {
  const structs = (
    /** @type {Array<GC|Item>} */
    transaction.doc.store.clients.get(clientid)
  );
  if (structs != null) {
    const lastStruct = structs[structs.length - 1];
    const clockState = lastStruct.id.clock + lastStruct.length;
    for (let i = 0, del = deletes[i]; i < deletes.length && del.clock < clockState; del = deletes[++i]) {
      iterateStructs(transaction, structs, del.clock, del.len, f);
    }
  }
});
var findIndexDS = (dis, clock) => {
  let left = 0;
  let right = dis.length - 1;
  while (left <= right) {
    const midindex = floor((left + right) / 2);
    const mid = dis[midindex];
    const midclock = mid.clock;
    if (midclock <= clock) {
      if (clock < midclock + mid.len) {
        return midindex;
      }
      left = midindex + 1;
    } else {
      right = midindex - 1;
    }
  }
  return null;
};
var isDeleted = (ds, id2) => {
  const dis = ds.clients.get(id2.client);
  return dis !== void 0 && findIndexDS(dis, id2.clock) !== null;
};
var sortAndMergeDeleteSet = (ds) => {
  ds.clients.forEach((dels) => {
    dels.sort((a, b) => a.clock - b.clock);
    let i, j;
    for (i = 1, j = 1; i < dels.length; i++) {
      const left = dels[j - 1];
      const right = dels[i];
      if (left.clock + left.len >= right.clock) {
        dels[j - 1] = new DeleteItem(left.clock, max(left.len, right.clock + right.len - left.clock));
      } else {
        if (j < i) {
          dels[j] = right;
        }
        j++;
      }
    }
    dels.length = j;
  });
};
var mergeDeleteSets = (dss) => {
  const merged = new DeleteSet();
  for (let dssI = 0; dssI < dss.length; dssI++) {
    dss[dssI].clients.forEach((delsLeft, client) => {
      if (!merged.clients.has(client)) {
        const dels = delsLeft.slice();
        for (let i = dssI + 1; i < dss.length; i++) {
          appendTo(dels, dss[i].clients.get(client) || []);
        }
        merged.clients.set(client, dels);
      }
    });
  }
  sortAndMergeDeleteSet(merged);
  return merged;
};
var addToDeleteSet = (ds, client, clock, length2) => {
  setIfUndefined(ds.clients, client, () => (
    /** @type {Array<DeleteItem>} */
    []
  )).push(new DeleteItem(clock, length2));
};
var createDeleteSet = () => new DeleteSet();
var createDeleteSetFromStructStore = (ss) => {
  const ds = createDeleteSet();
  ss.clients.forEach((structs, client) => {
    const dsitems = [];
    for (let i = 0; i < structs.length; i++) {
      const struct = structs[i];
      if (struct.deleted) {
        const clock = struct.id.clock;
        let len = struct.length;
        if (i + 1 < structs.length) {
          for (let next = structs[i + 1]; i + 1 < structs.length && next.deleted; next = structs[++i + 1]) {
            len += next.length;
          }
        }
        dsitems.push(new DeleteItem(clock, len));
      }
    }
    if (dsitems.length > 0) {
      ds.clients.set(client, dsitems);
    }
  });
  return ds;
};
var writeDeleteSet = (encoder2, ds) => {
  writeVarUint(encoder2.restEncoder, ds.clients.size);
  from(ds.clients.entries()).sort((a, b) => b[0] - a[0]).forEach(([client, dsitems]) => {
    encoder2.resetDsCurVal();
    writeVarUint(encoder2.restEncoder, client);
    const len = dsitems.length;
    writeVarUint(encoder2.restEncoder, len);
    for (let i = 0; i < len; i++) {
      const item = dsitems[i];
      encoder2.writeDsClock(item.clock);
      encoder2.writeDsLen(item.len);
    }
  });
};
var readDeleteSet = (decoder) => {
  const ds = new DeleteSet();
  const numClients = readVarUint(decoder.restDecoder);
  for (let i = 0; i < numClients; i++) {
    decoder.resetDsCurVal();
    const client = readVarUint(decoder.restDecoder);
    const numberOfDeletes = readVarUint(decoder.restDecoder);
    if (numberOfDeletes > 0) {
      const dsField = setIfUndefined(ds.clients, client, () => (
        /** @type {Array<DeleteItem>} */
        []
      ));
      for (let i2 = 0; i2 < numberOfDeletes; i2++) {
        dsField.push(new DeleteItem(decoder.readDsClock(), decoder.readDsLen()));
      }
    }
  }
  return ds;
};
var readAndApplyDeleteSet = (decoder, transaction, store) => {
  const unappliedDS = new DeleteSet();
  const numClients = readVarUint(decoder.restDecoder);
  for (let i = 0; i < numClients; i++) {
    decoder.resetDsCurVal();
    const client = readVarUint(decoder.restDecoder);
    const numberOfDeletes = readVarUint(decoder.restDecoder);
    const structs = store.clients.get(client) || [];
    const state = getState(store, client);
    for (let i2 = 0; i2 < numberOfDeletes; i2++) {
      const clock = decoder.readDsClock();
      const clockEnd = clock + decoder.readDsLen();
      if (clock < state) {
        if (state < clockEnd) {
          addToDeleteSet(unappliedDS, client, state, clockEnd - state);
        }
        let index = findIndexSS(structs, clock);
        let struct = structs[index];
        if (!struct.deleted && struct.id.clock < clock) {
          structs.splice(index + 1, 0, splitItem(transaction, struct, clock - struct.id.clock));
          index++;
        }
        while (index < structs.length) {
          struct = structs[index++];
          if (struct.id.clock < clockEnd) {
            if (!struct.deleted) {
              if (clockEnd < struct.id.clock + struct.length) {
                structs.splice(index, 0, splitItem(transaction, struct, clockEnd - struct.id.clock));
              }
              struct.delete(transaction);
            }
          } else {
            break;
          }
        }
      } else {
        addToDeleteSet(unappliedDS, client, clock, clockEnd - clock);
      }
    }
  }
  if (unappliedDS.clients.size > 0) {
    const ds = new UpdateEncoderV2();
    writeVarUint(ds.restEncoder, 0);
    writeDeleteSet(ds, unappliedDS);
    return ds.toUint8Array();
  }
  return null;
};
var generateNewClientId = uint32;
var Doc = class _Doc extends ObservableV2 {
  /**
   * @param {DocOpts} opts configuration
   */
  constructor({ guid = uuidv4(), collectionid = null, gc = true, gcFilter = () => true, meta = null, autoLoad = false, shouldLoad = true } = {}) {
    super();
    this.gc = gc;
    this.gcFilter = gcFilter;
    this.clientID = generateNewClientId();
    this.guid = guid;
    this.collectionid = collectionid;
    this.share = /* @__PURE__ */ new Map();
    this.store = new StructStore();
    this._transaction = null;
    this._transactionCleanups = [];
    this.subdocs = /* @__PURE__ */ new Set();
    this._item = null;
    this.shouldLoad = shouldLoad;
    this.autoLoad = autoLoad;
    this.meta = meta;
    this.isLoaded = false;
    this.isSynced = false;
    this.isDestroyed = false;
    this.whenLoaded = create4((resolve) => {
      this.on("load", () => {
        this.isLoaded = true;
        resolve(this);
      });
    });
    const provideSyncedPromise = () => create4((resolve) => {
      const eventHandler = (isSynced) => {
        if (isSynced === void 0 || isSynced === true) {
          this.off("sync", eventHandler);
          resolve();
        }
      };
      this.on("sync", eventHandler);
    });
    this.on("sync", (isSynced) => {
      if (isSynced === false && this.isSynced) {
        this.whenSynced = provideSyncedPromise();
      }
      this.isSynced = isSynced === void 0 || isSynced === true;
      if (this.isSynced && !this.isLoaded) {
        this.emit("load", [this]);
      }
    });
    this.whenSynced = provideSyncedPromise();
  }
  /**
   * Notify the parent document that you request to load data into this subdocument (if it is a subdocument).
   *
   * `load()` might be used in the future to request any provider to load the most current data.
   *
   * It is safe to call `load()` multiple times.
   */
  load() {
    const item = this._item;
    if (item !== null && !this.shouldLoad) {
      transact(
        /** @type {any} */
        item.parent.doc,
        (transaction) => {
          transaction.subdocsLoaded.add(this);
        },
        null,
        true
      );
    }
    this.shouldLoad = true;
  }
  getSubdocs() {
    return this.subdocs;
  }
  getSubdocGuids() {
    return new Set(from(this.subdocs).map((doc2) => doc2.guid));
  }
  /**
   * Changes that happen inside of a transaction are bundled. This means that
   * the observer fires _after_ the transaction is finished and that all changes
   * that happened inside of the transaction are sent as one message to the
   * other peers.
   *
   * @template T
   * @param {function(Transaction):T} f The function that should be executed as a transaction
   * @param {any} [origin] Origin of who started the transaction. Will be stored on transaction.origin
   * @return T
   *
   * @public
   */
  transact(f, origin = null) {
    return transact(this, f, origin);
  }
  /**
   * Define a shared data type.
   *
   * Multiple calls of `ydoc.get(name, TypeConstructor)` yield the same result
   * and do not overwrite each other. I.e.
   * `ydoc.get(name, Y.Array) === ydoc.get(name, Y.Array)`
   *
   * After this method is called, the type is also available on `ydoc.share.get(name)`.
   *
   * *Best Practices:*
   * Define all types right after the Y.Doc instance is created and store them in a separate object.
   * Also use the typed methods `getText(name)`, `getArray(name)`, ..
   *
   * @template {typeof AbstractType<any>} Type
   * @example
   *   const ydoc = new Y.Doc(..)
   *   const appState = {
   *     document: ydoc.getText('document')
   *     comments: ydoc.getArray('comments')
   *   }
   *
   * @param {string} name
   * @param {Type} TypeConstructor The constructor of the type definition. E.g. Y.Text, Y.Array, Y.Map, ...
   * @return {InstanceType<Type>} The created type. Constructed with TypeConstructor
   *
   * @public
   */
  get(name, TypeConstructor = (
    /** @type {any} */
    AbstractType
  )) {
    const type = setIfUndefined(this.share, name, () => {
      const t = new TypeConstructor();
      t._integrate(this, null);
      return t;
    });
    const Constr = type.constructor;
    if (TypeConstructor !== AbstractType && Constr !== TypeConstructor) {
      if (Constr === AbstractType) {
        const t = new TypeConstructor();
        t._map = type._map;
        type._map.forEach(
          /** @param {Item?} n */
          (n) => {
            for (; n !== null; n = n.left) {
              n.parent = t;
            }
          }
        );
        t._start = type._start;
        for (let n = t._start; n !== null; n = n.right) {
          n.parent = t;
        }
        t._length = type._length;
        this.share.set(name, t);
        t._integrate(this, null);
        return (
          /** @type {InstanceType<Type>} */
          t
        );
      } else {
        throw new Error(`Type with the name ${name} has already been defined with a different constructor`);
      }
    }
    return (
      /** @type {InstanceType<Type>} */
      type
    );
  }
  /**
   * @template T
   * @param {string} [name]
   * @return {YArray<T>}
   *
   * @public
   */
  getArray(name = "") {
    return (
      /** @type {YArray<T>} */
      this.get(name, YArray)
    );
  }
  /**
   * @param {string} [name]
   * @return {YText}
   *
   * @public
   */
  getText(name = "") {
    return this.get(name, YText);
  }
  /**
   * @template T
   * @param {string} [name]
   * @return {YMap<T>}
   *
   * @public
   */
  getMap(name = "") {
    return (
      /** @type {YMap<T>} */
      this.get(name, YMap)
    );
  }
  /**
   * @param {string} [name]
   * @return {YXmlElement}
   *
   * @public
   */
  getXmlElement(name = "") {
    return (
      /** @type {YXmlElement<{[key:string]:string}>} */
      this.get(name, YXmlElement)
    );
  }
  /**
   * @param {string} [name]
   * @return {YXmlFragment}
   *
   * @public
   */
  getXmlFragment(name = "") {
    return this.get(name, YXmlFragment);
  }
  /**
   * Converts the entire document into a js object, recursively traversing each yjs type
   * Doesn't log types that have not been defined (using ydoc.getType(..)).
   *
   * @deprecated Do not use this method and rather call toJSON directly on the shared types.
   *
   * @return {Object<string, any>}
   */
  toJSON() {
    const doc2 = {};
    this.share.forEach((value, key) => {
      doc2[key] = value.toJSON();
    });
    return doc2;
  }
  /**
   * Emit `destroy` event and unregister all event handlers.
   */
  destroy() {
    this.isDestroyed = true;
    from(this.subdocs).forEach((subdoc) => subdoc.destroy());
    const item = this._item;
    if (item !== null) {
      this._item = null;
      const content = (
        /** @type {ContentDoc} */
        item.content
      );
      content.doc = new _Doc({ guid: this.guid, ...content.opts, shouldLoad: false });
      content.doc._item = item;
      transact(
        /** @type {any} */
        item.parent.doc,
        (transaction) => {
          const doc2 = content.doc;
          if (!item.deleted) {
            transaction.subdocsAdded.add(doc2);
          }
          transaction.subdocsRemoved.add(this);
        },
        null,
        true
      );
    }
    this.emit("destroyed", [true]);
    this.emit("destroy", [this]);
    super.destroy();
  }
};
var DSDecoderV1 = class {
  /**
   * @param {decoding.Decoder} decoder
   */
  constructor(decoder) {
    this.restDecoder = decoder;
  }
  resetDsCurVal() {
  }
  /**
   * @return {number}
   */
  readDsClock() {
    return readVarUint(this.restDecoder);
  }
  /**
   * @return {number}
   */
  readDsLen() {
    return readVarUint(this.restDecoder);
  }
};
var UpdateDecoderV1 = class extends DSDecoderV1 {
  /**
   * @return {ID}
   */
  readLeftID() {
    return createID(readVarUint(this.restDecoder), readVarUint(this.restDecoder));
  }
  /**
   * @return {ID}
   */
  readRightID() {
    return createID(readVarUint(this.restDecoder), readVarUint(this.restDecoder));
  }
  /**
   * Read the next client id.
   * Use this in favor of readID whenever possible to reduce the number of objects created.
   */
  readClient() {
    return readVarUint(this.restDecoder);
  }
  /**
   * @return {number} info An unsigned 8-bit integer
   */
  readInfo() {
    return readUint8(this.restDecoder);
  }
  /**
   * @return {string}
   */
  readString() {
    return readVarString(this.restDecoder);
  }
  /**
   * @return {boolean} isKey
   */
  readParentInfo() {
    return readVarUint(this.restDecoder) === 1;
  }
  /**
   * @return {number} info An unsigned 8-bit integer
   */
  readTypeRef() {
    return readVarUint(this.restDecoder);
  }
  /**
   * Write len of a struct - well suited for Opt RLE encoder.
   *
   * @return {number} len
   */
  readLen() {
    return readVarUint(this.restDecoder);
  }
  /**
   * @return {any}
   */
  readAny() {
    return readAny(this.restDecoder);
  }
  /**
   * @return {Uint8Array}
   */
  readBuf() {
    return copyUint8Array(readVarUint8Array(this.restDecoder));
  }
  /**
   * Legacy implementation uses JSON parse. We use any-decoding in v2.
   *
   * @return {any}
   */
  readJSON() {
    return JSON.parse(readVarString(this.restDecoder));
  }
  /**
   * @return {string}
   */
  readKey() {
    return readVarString(this.restDecoder);
  }
};
var DSDecoderV2 = class {
  /**
   * @param {decoding.Decoder} decoder
   */
  constructor(decoder) {
    this.dsCurrVal = 0;
    this.restDecoder = decoder;
  }
  resetDsCurVal() {
    this.dsCurrVal = 0;
  }
  /**
   * @return {number}
   */
  readDsClock() {
    this.dsCurrVal += readVarUint(this.restDecoder);
    return this.dsCurrVal;
  }
  /**
   * @return {number}
   */
  readDsLen() {
    const diff = readVarUint(this.restDecoder) + 1;
    this.dsCurrVal += diff;
    return diff;
  }
};
var UpdateDecoderV2 = class extends DSDecoderV2 {
  /**
   * @param {decoding.Decoder} decoder
   */
  constructor(decoder) {
    super(decoder);
    this.keys = [];
    readVarUint(decoder);
    this.keyClockDecoder = new IntDiffOptRleDecoder(readVarUint8Array(decoder));
    this.clientDecoder = new UintOptRleDecoder(readVarUint8Array(decoder));
    this.leftClockDecoder = new IntDiffOptRleDecoder(readVarUint8Array(decoder));
    this.rightClockDecoder = new IntDiffOptRleDecoder(readVarUint8Array(decoder));
    this.infoDecoder = new RleDecoder(readVarUint8Array(decoder), readUint8);
    this.stringDecoder = new StringDecoder(readVarUint8Array(decoder));
    this.parentInfoDecoder = new RleDecoder(readVarUint8Array(decoder), readUint8);
    this.typeRefDecoder = new UintOptRleDecoder(readVarUint8Array(decoder));
    this.lenDecoder = new UintOptRleDecoder(readVarUint8Array(decoder));
  }
  /**
   * @return {ID}
   */
  readLeftID() {
    return new ID(this.clientDecoder.read(), this.leftClockDecoder.read());
  }
  /**
   * @return {ID}
   */
  readRightID() {
    return new ID(this.clientDecoder.read(), this.rightClockDecoder.read());
  }
  /**
   * Read the next client id.
   * Use this in favor of readID whenever possible to reduce the number of objects created.
   */
  readClient() {
    return this.clientDecoder.read();
  }
  /**
   * @return {number} info An unsigned 8-bit integer
   */
  readInfo() {
    return (
      /** @type {number} */
      this.infoDecoder.read()
    );
  }
  /**
   * @return {string}
   */
  readString() {
    return this.stringDecoder.read();
  }
  /**
   * @return {boolean}
   */
  readParentInfo() {
    return this.parentInfoDecoder.read() === 1;
  }
  /**
   * @return {number} An unsigned 8-bit integer
   */
  readTypeRef() {
    return this.typeRefDecoder.read();
  }
  /**
   * Write len of a struct - well suited for Opt RLE encoder.
   *
   * @return {number}
   */
  readLen() {
    return this.lenDecoder.read();
  }
  /**
   * @return {any}
   */
  readAny() {
    return readAny(this.restDecoder);
  }
  /**
   * @return {Uint8Array}
   */
  readBuf() {
    return readVarUint8Array(this.restDecoder);
  }
  /**
   * This is mainly here for legacy purposes.
   *
   * Initial we incoded objects using JSON. Now we use the much faster lib0/any-encoder. This method mainly exists for legacy purposes for the v1 encoder.
   *
   * @return {any}
   */
  readJSON() {
    return readAny(this.restDecoder);
  }
  /**
   * @return {string}
   */
  readKey() {
    const keyClock = this.keyClockDecoder.read();
    if (keyClock < this.keys.length) {
      return this.keys[keyClock];
    } else {
      const key = this.stringDecoder.read();
      this.keys.push(key);
      return key;
    }
  }
};
var DSEncoderV1 = class {
  constructor() {
    this.restEncoder = createEncoder();
  }
  toUint8Array() {
    return toUint8Array(this.restEncoder);
  }
  resetDsCurVal() {
  }
  /**
   * @param {number} clock
   */
  writeDsClock(clock) {
    writeVarUint(this.restEncoder, clock);
  }
  /**
   * @param {number} len
   */
  writeDsLen(len) {
    writeVarUint(this.restEncoder, len);
  }
};
var UpdateEncoderV1 = class extends DSEncoderV1 {
  /**
   * @param {ID} id
   */
  writeLeftID(id2) {
    writeVarUint(this.restEncoder, id2.client);
    writeVarUint(this.restEncoder, id2.clock);
  }
  /**
   * @param {ID} id
   */
  writeRightID(id2) {
    writeVarUint(this.restEncoder, id2.client);
    writeVarUint(this.restEncoder, id2.clock);
  }
  /**
   * Use writeClient and writeClock instead of writeID if possible.
   * @param {number} client
   */
  writeClient(client) {
    writeVarUint(this.restEncoder, client);
  }
  /**
   * @param {number} info An unsigned 8-bit integer
   */
  writeInfo(info) {
    writeUint8(this.restEncoder, info);
  }
  /**
   * @param {string} s
   */
  writeString(s) {
    writeVarString(this.restEncoder, s);
  }
  /**
   * @param {boolean} isYKey
   */
  writeParentInfo(isYKey) {
    writeVarUint(this.restEncoder, isYKey ? 1 : 0);
  }
  /**
   * @param {number} info An unsigned 8-bit integer
   */
  writeTypeRef(info) {
    writeVarUint(this.restEncoder, info);
  }
  /**
   * Write len of a struct - well suited for Opt RLE encoder.
   *
   * @param {number} len
   */
  writeLen(len) {
    writeVarUint(this.restEncoder, len);
  }
  /**
   * @param {any} any
   */
  writeAny(any2) {
    writeAny(this.restEncoder, any2);
  }
  /**
   * @param {Uint8Array} buf
   */
  writeBuf(buf) {
    writeVarUint8Array(this.restEncoder, buf);
  }
  /**
   * @param {any} embed
   */
  writeJSON(embed) {
    writeVarString(this.restEncoder, JSON.stringify(embed));
  }
  /**
   * @param {string} key
   */
  writeKey(key) {
    writeVarString(this.restEncoder, key);
  }
};
var DSEncoderV2 = class {
  constructor() {
    this.restEncoder = createEncoder();
    this.dsCurrVal = 0;
  }
  toUint8Array() {
    return toUint8Array(this.restEncoder);
  }
  resetDsCurVal() {
    this.dsCurrVal = 0;
  }
  /**
   * @param {number} clock
   */
  writeDsClock(clock) {
    const diff = clock - this.dsCurrVal;
    this.dsCurrVal = clock;
    writeVarUint(this.restEncoder, diff);
  }
  /**
   * @param {number} len
   */
  writeDsLen(len) {
    if (len === 0) {
      unexpectedCase();
    }
    writeVarUint(this.restEncoder, len - 1);
    this.dsCurrVal += len;
  }
};
var UpdateEncoderV2 = class extends DSEncoderV2 {
  constructor() {
    super();
    this.keyMap = /* @__PURE__ */ new Map();
    this.keyClock = 0;
    this.keyClockEncoder = new IntDiffOptRleEncoder();
    this.clientEncoder = new UintOptRleEncoder();
    this.leftClockEncoder = new IntDiffOptRleEncoder();
    this.rightClockEncoder = new IntDiffOptRleEncoder();
    this.infoEncoder = new RleEncoder(writeUint8);
    this.stringEncoder = new StringEncoder();
    this.parentInfoEncoder = new RleEncoder(writeUint8);
    this.typeRefEncoder = new UintOptRleEncoder();
    this.lenEncoder = new UintOptRleEncoder();
  }
  toUint8Array() {
    const encoder2 = createEncoder();
    writeVarUint(encoder2, 0);
    writeVarUint8Array(encoder2, this.keyClockEncoder.toUint8Array());
    writeVarUint8Array(encoder2, this.clientEncoder.toUint8Array());
    writeVarUint8Array(encoder2, this.leftClockEncoder.toUint8Array());
    writeVarUint8Array(encoder2, this.rightClockEncoder.toUint8Array());
    writeVarUint8Array(encoder2, toUint8Array(this.infoEncoder));
    writeVarUint8Array(encoder2, this.stringEncoder.toUint8Array());
    writeVarUint8Array(encoder2, toUint8Array(this.parentInfoEncoder));
    writeVarUint8Array(encoder2, this.typeRefEncoder.toUint8Array());
    writeVarUint8Array(encoder2, this.lenEncoder.toUint8Array());
    writeUint8Array(encoder2, toUint8Array(this.restEncoder));
    return toUint8Array(encoder2);
  }
  /**
   * @param {ID} id
   */
  writeLeftID(id2) {
    this.clientEncoder.write(id2.client);
    this.leftClockEncoder.write(id2.clock);
  }
  /**
   * @param {ID} id
   */
  writeRightID(id2) {
    this.clientEncoder.write(id2.client);
    this.rightClockEncoder.write(id2.clock);
  }
  /**
   * @param {number} client
   */
  writeClient(client) {
    this.clientEncoder.write(client);
  }
  /**
   * @param {number} info An unsigned 8-bit integer
   */
  writeInfo(info) {
    this.infoEncoder.write(info);
  }
  /**
   * @param {string} s
   */
  writeString(s) {
    this.stringEncoder.write(s);
  }
  /**
   * @param {boolean} isYKey
   */
  writeParentInfo(isYKey) {
    this.parentInfoEncoder.write(isYKey ? 1 : 0);
  }
  /**
   * @param {number} info An unsigned 8-bit integer
   */
  writeTypeRef(info) {
    this.typeRefEncoder.write(info);
  }
  /**
   * Write len of a struct - well suited for Opt RLE encoder.
   *
   * @param {number} len
   */
  writeLen(len) {
    this.lenEncoder.write(len);
  }
  /**
   * @param {any} any
   */
  writeAny(any2) {
    writeAny(this.restEncoder, any2);
  }
  /**
   * @param {Uint8Array} buf
   */
  writeBuf(buf) {
    writeVarUint8Array(this.restEncoder, buf);
  }
  /**
   * This is mainly here for legacy purposes.
   *
   * Initial we incoded objects using JSON. Now we use the much faster lib0/any-encoder. This method mainly exists for legacy purposes for the v1 encoder.
   *
   * @param {any} embed
   */
  writeJSON(embed) {
    writeAny(this.restEncoder, embed);
  }
  /**
   * Property keys are often reused. For example, in y-prosemirror the key `bold` might
   * occur very often. For a 3d application, the key `position` might occur very often.
   *
   * We cache these keys in a Map and refer to them via a unique number.
   *
   * @param {string} key
   */
  writeKey(key) {
    const clock = this.keyMap.get(key);
    if (clock === void 0) {
      this.keyClockEncoder.write(this.keyClock++);
      this.stringEncoder.write(key);
    } else {
      this.keyClockEncoder.write(clock);
    }
  }
};
var writeStructs = (encoder2, structs, client, clock) => {
  clock = max(clock, structs[0].id.clock);
  const startNewStructs = findIndexSS(structs, clock);
  writeVarUint(encoder2.restEncoder, structs.length - startNewStructs);
  encoder2.writeClient(client);
  writeVarUint(encoder2.restEncoder, clock);
  const firstStruct = structs[startNewStructs];
  firstStruct.write(encoder2, clock - firstStruct.id.clock);
  for (let i = startNewStructs + 1; i < structs.length; i++) {
    structs[i].write(encoder2, 0);
  }
};
var writeClientsStructs = (encoder2, store, _sm) => {
  const sm = /* @__PURE__ */ new Map();
  _sm.forEach((clock, client) => {
    if (getState(store, client) > clock) {
      sm.set(client, clock);
    }
  });
  getStateVector(store).forEach((_clock, client) => {
    if (!_sm.has(client)) {
      sm.set(client, 0);
    }
  });
  writeVarUint(encoder2.restEncoder, sm.size);
  from(sm.entries()).sort((a, b) => b[0] - a[0]).forEach(([client, clock]) => {
    writeStructs(
      encoder2,
      /** @type {Array<GC|Item>} */
      store.clients.get(client),
      client,
      clock
    );
  });
};
var readClientsStructRefs = (decoder, doc2) => {
  const clientRefs = create();
  const numOfStateUpdates = readVarUint(decoder.restDecoder);
  for (let i = 0; i < numOfStateUpdates; i++) {
    const numberOfStructs = readVarUint(decoder.restDecoder);
    const refs = new Array(numberOfStructs);
    const client = decoder.readClient();
    let clock = readVarUint(decoder.restDecoder);
    clientRefs.set(client, { i: 0, refs });
    for (let i2 = 0; i2 < numberOfStructs; i2++) {
      const info = decoder.readInfo();
      switch (BITS5 & info) {
        case 0: {
          const len = decoder.readLen();
          refs[i2] = new GC(createID(client, clock), len);
          clock += len;
          break;
        }
        case 10: {
          const len = readVarUint(decoder.restDecoder);
          refs[i2] = new Skip(createID(client, clock), len);
          clock += len;
          break;
        }
        default: {
          const cantCopyParentInfo = (info & (BIT7 | BIT8)) === 0;
          const struct = new Item(
            createID(client, clock),
            null,
            // left
            (info & BIT8) === BIT8 ? decoder.readLeftID() : null,
            // origin
            null,
            // right
            (info & BIT7) === BIT7 ? decoder.readRightID() : null,
            // right origin
            cantCopyParentInfo ? decoder.readParentInfo() ? doc2.get(decoder.readString()) : decoder.readLeftID() : null,
            // parent
            cantCopyParentInfo && (info & BIT6) === BIT6 ? decoder.readString() : null,
            // parentSub
            readItemContent(decoder, info)
            // item content
          );
          refs[i2] = struct;
          clock += struct.length;
        }
      }
    }
  }
  return clientRefs;
};
var integrateStructs = (transaction, store, clientsStructRefs) => {
  const stack = [];
  let clientsStructRefsIds = from(clientsStructRefs.keys()).sort((a, b) => a - b);
  if (clientsStructRefsIds.length === 0) {
    return null;
  }
  const getNextStructTarget = () => {
    if (clientsStructRefsIds.length === 0) {
      return null;
    }
    let nextStructsTarget = (
      /** @type {{i:number,refs:Array<GC|Item>}} */
      clientsStructRefs.get(clientsStructRefsIds[clientsStructRefsIds.length - 1])
    );
    while (nextStructsTarget.refs.length === nextStructsTarget.i) {
      clientsStructRefsIds.pop();
      if (clientsStructRefsIds.length > 0) {
        nextStructsTarget = /** @type {{i:number,refs:Array<GC|Item>}} */
        clientsStructRefs.get(clientsStructRefsIds[clientsStructRefsIds.length - 1]);
      } else {
        return null;
      }
    }
    return nextStructsTarget;
  };
  let curStructsTarget = getNextStructTarget();
  if (curStructsTarget === null) {
    return null;
  }
  const restStructs = new StructStore();
  const missingSV = /* @__PURE__ */ new Map();
  const updateMissingSv = (client, clock) => {
    const mclock = missingSV.get(client);
    if (mclock == null || mclock > clock) {
      missingSV.set(client, clock);
    }
  };
  let stackHead = (
    /** @type {any} */
    curStructsTarget.refs[
      /** @type {any} */
      curStructsTarget.i++
    ]
  );
  const state = /* @__PURE__ */ new Map();
  const addStackToRestSS = () => {
    for (const item of stack) {
      const client = item.id.client;
      const inapplicableItems = clientsStructRefs.get(client);
      if (inapplicableItems) {
        inapplicableItems.i--;
        restStructs.clients.set(client, inapplicableItems.refs.slice(inapplicableItems.i));
        clientsStructRefs.delete(client);
        inapplicableItems.i = 0;
        inapplicableItems.refs = [];
      } else {
        restStructs.clients.set(client, [item]);
      }
      clientsStructRefsIds = clientsStructRefsIds.filter((c) => c !== client);
    }
    stack.length = 0;
  };
  while (true) {
    if (stackHead.constructor !== Skip) {
      const localClock = setIfUndefined(state, stackHead.id.client, () => getState(store, stackHead.id.client));
      const offset = localClock - stackHead.id.clock;
      if (offset < 0) {
        stack.push(stackHead);
        updateMissingSv(stackHead.id.client, stackHead.id.clock - 1);
        addStackToRestSS();
      } else {
        const missing = stackHead.getMissing(transaction, store);
        if (missing !== null) {
          stack.push(stackHead);
          const structRefs = clientsStructRefs.get(
            /** @type {number} */
            missing
          ) || { refs: [], i: 0 };
          if (structRefs.refs.length === structRefs.i) {
            updateMissingSv(
              /** @type {number} */
              missing,
              getState(store, missing)
            );
            addStackToRestSS();
          } else {
            stackHead = structRefs.refs[structRefs.i++];
            continue;
          }
        } else if (offset === 0 || offset < stackHead.length) {
          stackHead.integrate(transaction, offset);
          state.set(stackHead.id.client, stackHead.id.clock + stackHead.length);
        }
      }
    }
    if (stack.length > 0) {
      stackHead = /** @type {GC|Item} */
      stack.pop();
    } else if (curStructsTarget !== null && curStructsTarget.i < curStructsTarget.refs.length) {
      stackHead = /** @type {GC|Item} */
      curStructsTarget.refs[curStructsTarget.i++];
    } else {
      curStructsTarget = getNextStructTarget();
      if (curStructsTarget === null) {
        break;
      } else {
        stackHead = /** @type {GC|Item} */
        curStructsTarget.refs[curStructsTarget.i++];
      }
    }
  }
  if (restStructs.clients.size > 0) {
    const encoder2 = new UpdateEncoderV2();
    writeClientsStructs(encoder2, restStructs, /* @__PURE__ */ new Map());
    writeVarUint(encoder2.restEncoder, 0);
    return { missing: missingSV, update: encoder2.toUint8Array() };
  }
  return null;
};
var writeStructsFromTransaction = (encoder2, transaction) => writeClientsStructs(encoder2, transaction.doc.store, transaction.beforeState);
var readUpdateV2 = (decoder, ydoc, transactionOrigin, structDecoder = new UpdateDecoderV2(decoder)) => transact(ydoc, (transaction) => {
  transaction.local = false;
  let retry = false;
  const doc2 = transaction.doc;
  const store = doc2.store;
  const ss = readClientsStructRefs(structDecoder, doc2);
  const restStructs = integrateStructs(transaction, store, ss);
  const pending = store.pendingStructs;
  if (pending) {
    for (const [client, clock] of pending.missing) {
      if (clock < getState(store, client)) {
        retry = true;
        break;
      }
    }
    if (restStructs) {
      for (const [client, clock] of restStructs.missing) {
        const mclock = pending.missing.get(client);
        if (mclock == null || mclock > clock) {
          pending.missing.set(client, clock);
        }
      }
      pending.update = mergeUpdatesV2([pending.update, restStructs.update]);
    }
  } else {
    store.pendingStructs = restStructs;
  }
  const dsRest = readAndApplyDeleteSet(structDecoder, transaction, store);
  if (store.pendingDs) {
    const pendingDSUpdate = new UpdateDecoderV2(createDecoder(store.pendingDs));
    readVarUint(pendingDSUpdate.restDecoder);
    const dsRest2 = readAndApplyDeleteSet(pendingDSUpdate, transaction, store);
    if (dsRest && dsRest2) {
      store.pendingDs = mergeUpdatesV2([dsRest, dsRest2]);
    } else {
      store.pendingDs = dsRest || dsRest2;
    }
  } else {
    store.pendingDs = dsRest;
  }
  if (retry) {
    const update = (
      /** @type {{update: Uint8Array}} */
      store.pendingStructs.update
    );
    store.pendingStructs = null;
    applyUpdateV2(transaction.doc, update);
  }
}, transactionOrigin, false);
var applyUpdateV2 = (ydoc, update, transactionOrigin, YDecoder = UpdateDecoderV2) => {
  const decoder = createDecoder(update);
  readUpdateV2(decoder, ydoc, transactionOrigin, new YDecoder(decoder));
};
var applyUpdate = (ydoc, update, transactionOrigin) => applyUpdateV2(ydoc, update, transactionOrigin, UpdateDecoderV1);
var writeStateAsUpdate = (encoder2, doc2, targetStateVector = /* @__PURE__ */ new Map()) => {
  writeClientsStructs(encoder2, doc2.store, targetStateVector);
  writeDeleteSet(encoder2, createDeleteSetFromStructStore(doc2.store));
};
var encodeStateAsUpdateV2 = (doc2, encodedTargetStateVector = new Uint8Array([0]), encoder2 = new UpdateEncoderV2()) => {
  const targetStateVector = decodeStateVector(encodedTargetStateVector);
  writeStateAsUpdate(encoder2, doc2, targetStateVector);
  const updates = [encoder2.toUint8Array()];
  if (doc2.store.pendingDs) {
    updates.push(doc2.store.pendingDs);
  }
  if (doc2.store.pendingStructs) {
    updates.push(diffUpdateV2(doc2.store.pendingStructs.update, encodedTargetStateVector));
  }
  if (updates.length > 1) {
    if (encoder2.constructor === UpdateEncoderV1) {
      return mergeUpdates(updates.map((update, i) => i === 0 ? update : convertUpdateFormatV2ToV1(update)));
    } else if (encoder2.constructor === UpdateEncoderV2) {
      return mergeUpdatesV2(updates);
    }
  }
  return updates[0];
};
var encodeStateAsUpdate = (doc2, encodedTargetStateVector) => encodeStateAsUpdateV2(doc2, encodedTargetStateVector, new UpdateEncoderV1());
var readStateVector = (decoder) => {
  const ss = /* @__PURE__ */ new Map();
  const ssLength = readVarUint(decoder.restDecoder);
  for (let i = 0; i < ssLength; i++) {
    const client = readVarUint(decoder.restDecoder);
    const clock = readVarUint(decoder.restDecoder);
    ss.set(client, clock);
  }
  return ss;
};
var decodeStateVector = (decodedState) => readStateVector(new DSDecoderV1(createDecoder(decodedState)));
var writeStateVector = (encoder2, sv) => {
  writeVarUint(encoder2.restEncoder, sv.size);
  from(sv.entries()).sort((a, b) => b[0] - a[0]).forEach(([client, clock]) => {
    writeVarUint(encoder2.restEncoder, client);
    writeVarUint(encoder2.restEncoder, clock);
  });
  return encoder2;
};
var writeDocumentStateVector = (encoder2, doc2) => writeStateVector(encoder2, getStateVector(doc2.store));
var encodeStateVectorV2 = (doc2, encoder2 = new DSEncoderV2()) => {
  if (doc2 instanceof Map) {
    writeStateVector(encoder2, doc2);
  } else {
    writeDocumentStateVector(encoder2, doc2);
  }
  return encoder2.toUint8Array();
};
var encodeStateVector = (doc2) => encodeStateVectorV2(doc2, new DSEncoderV1());
var EventHandler = class {
  constructor() {
    this.l = [];
  }
};
var createEventHandler = () => new EventHandler();
var addEventHandlerListener = (eventHandler, f) => eventHandler.l.push(f);
var removeEventHandlerListener = (eventHandler, f) => {
  const l = eventHandler.l;
  const len = l.length;
  eventHandler.l = l.filter((g) => f !== g);
  if (len === eventHandler.l.length) {
    console.error("[yjs] Tried to remove event handler that doesn't exist.");
  }
};
var callEventHandlerListeners = (eventHandler, arg0, arg1) => callAll(eventHandler.l, [arg0, arg1]);
var ID = class {
  /**
   * @param {number} client client id
   * @param {number} clock unique per client id, continuous number
   */
  constructor(client, clock) {
    this.client = client;
    this.clock = clock;
  }
};
var compareIDs = (a, b) => a === b || a !== null && b !== null && a.client === b.client && a.clock === b.clock;
var createID = (client, clock) => new ID(client, clock);
var findRootTypeKey = (type) => {
  for (const [key, value] of type.doc.share.entries()) {
    if (value === type) {
      return key;
    }
  }
  throw unexpectedCase();
};
var Snapshot = class {
  /**
   * @param {DeleteSet} ds
   * @param {Map<number,number>} sv state map
   */
  constructor(ds, sv) {
    this.ds = ds;
    this.sv = sv;
  }
};
var createSnapshot = (ds, sm) => new Snapshot(ds, sm);
var emptySnapshot = createSnapshot(createDeleteSet(), /* @__PURE__ */ new Map());
var isVisible = (item, snapshot) => snapshot === void 0 ? !item.deleted : snapshot.sv.has(item.id.client) && (snapshot.sv.get(item.id.client) || 0) > item.id.clock && !isDeleted(snapshot.ds, item.id);
var splitSnapshotAffectedStructs = (transaction, snapshot) => {
  const meta = setIfUndefined(transaction.meta, splitSnapshotAffectedStructs, create2);
  const store = transaction.doc.store;
  if (!meta.has(snapshot)) {
    snapshot.sv.forEach((clock, client) => {
      if (clock < getState(store, client)) {
        getItemCleanStart(transaction, createID(client, clock));
      }
    });
    iterateDeletedStructs(transaction, snapshot.ds, (_item) => {
    });
    meta.add(snapshot);
  }
};
var StructStore = class {
  constructor() {
    this.clients = /* @__PURE__ */ new Map();
    this.pendingStructs = null;
    this.pendingDs = null;
  }
};
var getStateVector = (store) => {
  const sm = /* @__PURE__ */ new Map();
  store.clients.forEach((structs, client) => {
    const struct = structs[structs.length - 1];
    sm.set(client, struct.id.clock + struct.length);
  });
  return sm;
};
var getState = (store, client) => {
  const structs = store.clients.get(client);
  if (structs === void 0) {
    return 0;
  }
  const lastStruct = structs[structs.length - 1];
  return lastStruct.id.clock + lastStruct.length;
};
var addStruct = (store, struct) => {
  let structs = store.clients.get(struct.id.client);
  if (structs === void 0) {
    structs = [];
    store.clients.set(struct.id.client, structs);
  } else {
    const lastStruct = structs[structs.length - 1];
    if (lastStruct.id.clock + lastStruct.length !== struct.id.clock) {
      throw unexpectedCase();
    }
  }
  structs.push(struct);
};
var findIndexSS = (structs, clock) => {
  let left = 0;
  let right = structs.length - 1;
  let mid = structs[right];
  let midclock = mid.id.clock;
  if (midclock === clock) {
    return right;
  }
  let midindex = floor(clock / (midclock + mid.length - 1) * right);
  while (left <= right) {
    mid = structs[midindex];
    midclock = mid.id.clock;
    if (midclock <= clock) {
      if (clock < midclock + mid.length) {
        return midindex;
      }
      left = midindex + 1;
    } else {
      right = midindex - 1;
    }
    midindex = floor((left + right) / 2);
  }
  throw unexpectedCase();
};
var find = (store, id2) => {
  const structs = store.clients.get(id2.client);
  return structs[findIndexSS(structs, id2.clock)];
};
var getItem = (
  /** @type {function(StructStore,ID):Item} */
  find
);
var findIndexCleanStart = (transaction, structs, clock) => {
  const index = findIndexSS(structs, clock);
  const struct = structs[index];
  if (struct.id.clock < clock && struct instanceof Item) {
    structs.splice(index + 1, 0, splitItem(transaction, struct, clock - struct.id.clock));
    return index + 1;
  }
  return index;
};
var getItemCleanStart = (transaction, id2) => {
  const structs = (
    /** @type {Array<Item>} */
    transaction.doc.store.clients.get(id2.client)
  );
  return structs[findIndexCleanStart(transaction, structs, id2.clock)];
};
var getItemCleanEnd = (transaction, store, id2) => {
  const structs = store.clients.get(id2.client);
  const index = findIndexSS(structs, id2.clock);
  const struct = structs[index];
  if (id2.clock !== struct.id.clock + struct.length - 1 && struct.constructor !== GC) {
    structs.splice(index + 1, 0, splitItem(transaction, struct, id2.clock - struct.id.clock + 1));
  }
  return struct;
};
var replaceStruct = (store, struct, newStruct) => {
  const structs = (
    /** @type {Array<GC|Item>} */
    store.clients.get(struct.id.client)
  );
  structs[findIndexSS(structs, struct.id.clock)] = newStruct;
};
var iterateStructs = (transaction, structs, clockStart, len, f) => {
  if (len === 0) {
    return;
  }
  const clockEnd = clockStart + len;
  let index = findIndexCleanStart(transaction, structs, clockStart);
  let struct;
  do {
    struct = structs[index++];
    if (clockEnd < struct.id.clock + struct.length) {
      findIndexCleanStart(transaction, structs, clockEnd);
    }
    f(struct);
  } while (index < structs.length && structs[index].id.clock < clockEnd);
};
var Transaction = class {
  /**
   * @param {Doc} doc
   * @param {any} origin
   * @param {boolean} local
   */
  constructor(doc2, origin, local) {
    this.doc = doc2;
    this.deleteSet = new DeleteSet();
    this.beforeState = getStateVector(doc2.store);
    this.afterState = /* @__PURE__ */ new Map();
    this.changed = /* @__PURE__ */ new Map();
    this.changedParentTypes = /* @__PURE__ */ new Map();
    this._mergeStructs = [];
    this.origin = origin;
    this.meta = /* @__PURE__ */ new Map();
    this.local = local;
    this.subdocsAdded = /* @__PURE__ */ new Set();
    this.subdocsRemoved = /* @__PURE__ */ new Set();
    this.subdocsLoaded = /* @__PURE__ */ new Set();
    this._needFormattingCleanup = false;
  }
};
var writeUpdateMessageFromTransaction = (encoder2, transaction) => {
  if (transaction.deleteSet.clients.size === 0 && !any(transaction.afterState, (clock, client) => transaction.beforeState.get(client) !== clock)) {
    return false;
  }
  sortAndMergeDeleteSet(transaction.deleteSet);
  writeStructsFromTransaction(encoder2, transaction);
  writeDeleteSet(encoder2, transaction.deleteSet);
  return true;
};
var addChangedTypeToTransaction = (transaction, type, parentSub) => {
  const item = type._item;
  if (item === null || item.id.clock < (transaction.beforeState.get(item.id.client) || 0) && !item.deleted) {
    setIfUndefined(transaction.changed, type, create2).add(parentSub);
  }
};
var tryToMergeWithLefts = (structs, pos) => {
  let right = structs[pos];
  let left = structs[pos - 1];
  let i = pos;
  for (; i > 0; right = left, left = structs[--i - 1]) {
    if (left.deleted === right.deleted && left.constructor === right.constructor) {
      if (left.mergeWith(right)) {
        if (right instanceof Item && right.parentSub !== null && /** @type {AbstractType<any>} */
        right.parent._map.get(right.parentSub) === right) {
          right.parent._map.set(
            right.parentSub,
            /** @type {Item} */
            left
          );
        }
        continue;
      }
    }
    break;
  }
  const merged = pos - i;
  if (merged) {
    structs.splice(pos + 1 - merged, merged);
  }
  return merged;
};
var tryGcDeleteSet = (ds, store, gcFilter) => {
  for (const [client, deleteItems] of ds.clients.entries()) {
    const structs = (
      /** @type {Array<GC|Item>} */
      store.clients.get(client)
    );
    for (let di = deleteItems.length - 1; di >= 0; di--) {
      const deleteItem = deleteItems[di];
      const endDeleteItemClock = deleteItem.clock + deleteItem.len;
      for (let si = findIndexSS(structs, deleteItem.clock), struct = structs[si]; si < structs.length && struct.id.clock < endDeleteItemClock; struct = structs[++si]) {
        const struct2 = structs[si];
        if (deleteItem.clock + deleteItem.len <= struct2.id.clock) {
          break;
        }
        if (struct2 instanceof Item && struct2.deleted && !struct2.keep && gcFilter(struct2)) {
          struct2.gc(store, false);
        }
      }
    }
  }
};
var tryMergeDeleteSet = (ds, store) => {
  ds.clients.forEach((deleteItems, client) => {
    const structs = (
      /** @type {Array<GC|Item>} */
      store.clients.get(client)
    );
    for (let di = deleteItems.length - 1; di >= 0; di--) {
      const deleteItem = deleteItems[di];
      const mostRightIndexToCheck = min(structs.length - 1, 1 + findIndexSS(structs, deleteItem.clock + deleteItem.len - 1));
      for (let si = mostRightIndexToCheck, struct = structs[si]; si > 0 && struct.id.clock >= deleteItem.clock; struct = structs[si]) {
        si -= 1 + tryToMergeWithLefts(structs, si);
      }
    }
  });
};
var cleanupTransactions = (transactionCleanups, i) => {
  if (i < transactionCleanups.length) {
    const transaction = transactionCleanups[i];
    const doc2 = transaction.doc;
    const store = doc2.store;
    const ds = transaction.deleteSet;
    const mergeStructs = transaction._mergeStructs;
    try {
      sortAndMergeDeleteSet(ds);
      transaction.afterState = getStateVector(transaction.doc.store);
      doc2.emit("beforeObserverCalls", [transaction, doc2]);
      const fs = [];
      transaction.changed.forEach(
        (subs, itemtype) => fs.push(() => {
          if (itemtype._item === null || !itemtype._item.deleted) {
            itemtype._callObserver(transaction, subs);
          }
        })
      );
      fs.push(() => {
        transaction.changedParentTypes.forEach((events, type) => {
          if (type._dEH.l.length > 0 && (type._item === null || !type._item.deleted)) {
            fs.push(() => {
              events = events.filter(
                (event) => event.target._item === null || !event.target._item.deleted
              );
              events.forEach((event) => {
                event.currentTarget = type;
                event._path = null;
              });
              events.sort((event1, event2) => event1.path.length - event2.path.length);
              callEventHandlerListeners(type._dEH, events, transaction);
            });
          }
        });
        fs.push(() => doc2.emit("afterTransaction", [transaction, doc2]));
        fs.push(() => {
          if (transaction._needFormattingCleanup) {
            cleanupYTextAfterTransaction(transaction);
          }
        });
      });
      callAll(fs, []);
    } finally {
      if (doc2.gc) {
        tryGcDeleteSet(ds, store, doc2.gcFilter);
      }
      tryMergeDeleteSet(ds, store);
      transaction.afterState.forEach((clock, client) => {
        const beforeClock = transaction.beforeState.get(client) || 0;
        if (beforeClock !== clock) {
          const structs = (
            /** @type {Array<GC|Item>} */
            store.clients.get(client)
          );
          const firstChangePos = max(findIndexSS(structs, beforeClock), 1);
          for (let i2 = structs.length - 1; i2 >= firstChangePos; ) {
            i2 -= 1 + tryToMergeWithLefts(structs, i2);
          }
        }
      });
      for (let i2 = mergeStructs.length - 1; i2 >= 0; i2--) {
        const { client, clock } = mergeStructs[i2].id;
        const structs = (
          /** @type {Array<GC|Item>} */
          store.clients.get(client)
        );
        const replacedStructPos = findIndexSS(structs, clock);
        if (replacedStructPos + 1 < structs.length) {
          if (tryToMergeWithLefts(structs, replacedStructPos + 1) > 1) {
            continue;
          }
        }
        if (replacedStructPos > 0) {
          tryToMergeWithLefts(structs, replacedStructPos);
        }
      }
      if (!transaction.local && transaction.afterState.get(doc2.clientID) !== transaction.beforeState.get(doc2.clientID)) {
        print(ORANGE, BOLD, "[yjs] ", UNBOLD, RED, "Changed the client-id because another client seems to be using it.");
        doc2.clientID = generateNewClientId();
      }
      doc2.emit("afterTransactionCleanup", [transaction, doc2]);
      if (doc2._observers.has("update")) {
        const encoder2 = new UpdateEncoderV1();
        const hasContent2 = writeUpdateMessageFromTransaction(encoder2, transaction);
        if (hasContent2) {
          doc2.emit("update", [encoder2.toUint8Array(), transaction.origin, doc2, transaction]);
        }
      }
      if (doc2._observers.has("updateV2")) {
        const encoder2 = new UpdateEncoderV2();
        const hasContent2 = writeUpdateMessageFromTransaction(encoder2, transaction);
        if (hasContent2) {
          doc2.emit("updateV2", [encoder2.toUint8Array(), transaction.origin, doc2, transaction]);
        }
      }
      const { subdocsAdded, subdocsLoaded, subdocsRemoved } = transaction;
      if (subdocsAdded.size > 0 || subdocsRemoved.size > 0 || subdocsLoaded.size > 0) {
        subdocsAdded.forEach((subdoc) => {
          subdoc.clientID = doc2.clientID;
          if (subdoc.collectionid == null) {
            subdoc.collectionid = doc2.collectionid;
          }
          doc2.subdocs.add(subdoc);
        });
        subdocsRemoved.forEach((subdoc) => doc2.subdocs.delete(subdoc));
        doc2.emit("subdocs", [{ loaded: subdocsLoaded, added: subdocsAdded, removed: subdocsRemoved }, doc2, transaction]);
        subdocsRemoved.forEach((subdoc) => subdoc.destroy());
      }
      if (transactionCleanups.length <= i + 1) {
        doc2._transactionCleanups = [];
        doc2.emit("afterAllTransactions", [doc2, transactionCleanups]);
      } else {
        cleanupTransactions(transactionCleanups, i + 1);
      }
    }
  }
};
var transact = (doc2, f, origin = null, local = true) => {
  const transactionCleanups = doc2._transactionCleanups;
  let initialCall = false;
  let result = null;
  if (doc2._transaction === null) {
    initialCall = true;
    doc2._transaction = new Transaction(doc2, origin, local);
    transactionCleanups.push(doc2._transaction);
    if (transactionCleanups.length === 1) {
      doc2.emit("beforeAllTransactions", [doc2]);
    }
    doc2.emit("beforeTransaction", [doc2._transaction, doc2]);
  }
  try {
    result = f(doc2._transaction);
  } finally {
    if (initialCall) {
      const finishCleanup = doc2._transaction === transactionCleanups[0];
      doc2._transaction = null;
      if (finishCleanup) {
        cleanupTransactions(transactionCleanups, 0);
      }
    }
  }
  return result;
};
function* lazyStructReaderGenerator(decoder) {
  const numOfStateUpdates = readVarUint(decoder.restDecoder);
  for (let i = 0; i < numOfStateUpdates; i++) {
    const numberOfStructs = readVarUint(decoder.restDecoder);
    const client = decoder.readClient();
    let clock = readVarUint(decoder.restDecoder);
    for (let i2 = 0; i2 < numberOfStructs; i2++) {
      const info = decoder.readInfo();
      if (info === 10) {
        const len = readVarUint(decoder.restDecoder);
        yield new Skip(createID(client, clock), len);
        clock += len;
      } else if ((BITS5 & info) !== 0) {
        const cantCopyParentInfo = (info & (BIT7 | BIT8)) === 0;
        const struct = new Item(
          createID(client, clock),
          null,
          // left
          (info & BIT8) === BIT8 ? decoder.readLeftID() : null,
          // origin
          null,
          // right
          (info & BIT7) === BIT7 ? decoder.readRightID() : null,
          // right origin
          // @ts-ignore Force writing a string here.
          cantCopyParentInfo ? decoder.readParentInfo() ? decoder.readString() : decoder.readLeftID() : null,
          // parent
          cantCopyParentInfo && (info & BIT6) === BIT6 ? decoder.readString() : null,
          // parentSub
          readItemContent(decoder, info)
          // item content
        );
        yield struct;
        clock += struct.length;
      } else {
        const len = decoder.readLen();
        yield new GC(createID(client, clock), len);
        clock += len;
      }
    }
  }
}
var LazyStructReader = class {
  /**
   * @param {UpdateDecoderV1 | UpdateDecoderV2} decoder
   * @param {boolean} filterSkips
   */
  constructor(decoder, filterSkips) {
    this.gen = lazyStructReaderGenerator(decoder);
    this.curr = null;
    this.done = false;
    this.filterSkips = filterSkips;
    this.next();
  }
  /**
   * @return {Item | GC | Skip |null}
   */
  next() {
    do {
      this.curr = this.gen.next().value || null;
    } while (this.filterSkips && this.curr !== null && this.curr.constructor === Skip);
    return this.curr;
  }
};
var LazyStructWriter = class {
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   */
  constructor(encoder2) {
    this.currClient = 0;
    this.startClock = 0;
    this.written = 0;
    this.encoder = encoder2;
    this.clientStructs = [];
  }
};
var mergeUpdates = (updates) => mergeUpdatesV2(updates, UpdateDecoderV1, UpdateEncoderV1);
var sliceStruct = (left, diff) => {
  if (left.constructor === GC) {
    const { client, clock } = left.id;
    return new GC(createID(client, clock + diff), left.length - diff);
  } else if (left.constructor === Skip) {
    const { client, clock } = left.id;
    return new Skip(createID(client, clock + diff), left.length - diff);
  } else {
    const leftItem = (
      /** @type {Item} */
      left
    );
    const { client, clock } = leftItem.id;
    return new Item(
      createID(client, clock + diff),
      null,
      createID(client, clock + diff - 1),
      null,
      leftItem.rightOrigin,
      leftItem.parent,
      leftItem.parentSub,
      leftItem.content.splice(diff)
    );
  }
};
var mergeUpdatesV2 = (updates, YDecoder = UpdateDecoderV2, YEncoder = UpdateEncoderV2) => {
  if (updates.length === 1) {
    return updates[0];
  }
  const updateDecoders = updates.map((update) => new YDecoder(createDecoder(update)));
  let lazyStructDecoders = updateDecoders.map((decoder) => new LazyStructReader(decoder, true));
  let currWrite = null;
  const updateEncoder = new YEncoder();
  const lazyStructEncoder = new LazyStructWriter(updateEncoder);
  while (true) {
    lazyStructDecoders = lazyStructDecoders.filter((dec) => dec.curr !== null);
    lazyStructDecoders.sort(
      /** @type {function(any,any):number} */
      (dec1, dec2) => {
        if (dec1.curr.id.client === dec2.curr.id.client) {
          const clockDiff = dec1.curr.id.clock - dec2.curr.id.clock;
          if (clockDiff === 0) {
            return dec1.curr.constructor === dec2.curr.constructor ? 0 : dec1.curr.constructor === Skip ? 1 : -1;
          } else {
            return clockDiff;
          }
        } else {
          return dec2.curr.id.client - dec1.curr.id.client;
        }
      }
    );
    if (lazyStructDecoders.length === 0) {
      break;
    }
    const currDecoder = lazyStructDecoders[0];
    const firstClient = (
      /** @type {Item | GC} */
      currDecoder.curr.id.client
    );
    if (currWrite !== null) {
      let curr = (
        /** @type {Item | GC | null} */
        currDecoder.curr
      );
      let iterated = false;
      while (curr !== null && curr.id.clock + curr.length <= currWrite.struct.id.clock + currWrite.struct.length && curr.id.client >= currWrite.struct.id.client) {
        curr = currDecoder.next();
        iterated = true;
      }
      if (curr === null || // current decoder is empty
      curr.id.client !== firstClient || // check whether there is another decoder that has has updates from `firstClient`
      iterated && curr.id.clock > currWrite.struct.id.clock + currWrite.struct.length) {
        continue;
      }
      if (firstClient !== currWrite.struct.id.client) {
        writeStructToLazyStructWriter(lazyStructEncoder, currWrite.struct, currWrite.offset);
        currWrite = { struct: curr, offset: 0 };
        currDecoder.next();
      } else {
        if (currWrite.struct.id.clock + currWrite.struct.length < curr.id.clock) {
          if (currWrite.struct.constructor === Skip) {
            currWrite.struct.length = curr.id.clock + curr.length - currWrite.struct.id.clock;
          } else {
            writeStructToLazyStructWriter(lazyStructEncoder, currWrite.struct, currWrite.offset);
            const diff = curr.id.clock - currWrite.struct.id.clock - currWrite.struct.length;
            const struct = new Skip(createID(firstClient, currWrite.struct.id.clock + currWrite.struct.length), diff);
            currWrite = { struct, offset: 0 };
          }
        } else {
          const diff = currWrite.struct.id.clock + currWrite.struct.length - curr.id.clock;
          if (diff > 0) {
            if (currWrite.struct.constructor === Skip) {
              currWrite.struct.length -= diff;
            } else {
              curr = sliceStruct(curr, diff);
            }
          }
          if (!currWrite.struct.mergeWith(
            /** @type {any} */
            curr
          )) {
            writeStructToLazyStructWriter(lazyStructEncoder, currWrite.struct, currWrite.offset);
            currWrite = { struct: curr, offset: 0 };
            currDecoder.next();
          }
        }
      }
    } else {
      currWrite = { struct: (
        /** @type {Item | GC} */
        currDecoder.curr
      ), offset: 0 };
      currDecoder.next();
    }
    for (let next = currDecoder.curr; next !== null && next.id.client === firstClient && next.id.clock === currWrite.struct.id.clock + currWrite.struct.length && next.constructor !== Skip; next = currDecoder.next()) {
      writeStructToLazyStructWriter(lazyStructEncoder, currWrite.struct, currWrite.offset);
      currWrite = { struct: next, offset: 0 };
    }
  }
  if (currWrite !== null) {
    writeStructToLazyStructWriter(lazyStructEncoder, currWrite.struct, currWrite.offset);
    currWrite = null;
  }
  finishLazyStructWriting(lazyStructEncoder);
  const dss = updateDecoders.map((decoder) => readDeleteSet(decoder));
  const ds = mergeDeleteSets(dss);
  writeDeleteSet(updateEncoder, ds);
  return updateEncoder.toUint8Array();
};
var diffUpdateV2 = (update, sv, YDecoder = UpdateDecoderV2, YEncoder = UpdateEncoderV2) => {
  const state = decodeStateVector(sv);
  const encoder2 = new YEncoder();
  const lazyStructWriter = new LazyStructWriter(encoder2);
  const decoder = new YDecoder(createDecoder(update));
  const reader = new LazyStructReader(decoder, false);
  while (reader.curr) {
    const curr = reader.curr;
    const currClient = curr.id.client;
    const svClock = state.get(currClient) || 0;
    if (reader.curr.constructor === Skip) {
      reader.next();
      continue;
    }
    if (curr.id.clock + curr.length > svClock) {
      writeStructToLazyStructWriter(lazyStructWriter, curr, max(svClock - curr.id.clock, 0));
      reader.next();
      while (reader.curr && reader.curr.id.client === currClient) {
        writeStructToLazyStructWriter(lazyStructWriter, reader.curr, 0);
        reader.next();
      }
    } else {
      while (reader.curr && reader.curr.id.client === currClient && reader.curr.id.clock + reader.curr.length <= svClock) {
        reader.next();
      }
    }
  }
  finishLazyStructWriting(lazyStructWriter);
  const ds = readDeleteSet(decoder);
  writeDeleteSet(encoder2, ds);
  return encoder2.toUint8Array();
};
var flushLazyStructWriter = (lazyWriter) => {
  if (lazyWriter.written > 0) {
    lazyWriter.clientStructs.push({ written: lazyWriter.written, restEncoder: toUint8Array(lazyWriter.encoder.restEncoder) });
    lazyWriter.encoder.restEncoder = createEncoder();
    lazyWriter.written = 0;
  }
};
var writeStructToLazyStructWriter = (lazyWriter, struct, offset) => {
  if (lazyWriter.written > 0 && lazyWriter.currClient !== struct.id.client) {
    flushLazyStructWriter(lazyWriter);
  }
  if (lazyWriter.written === 0) {
    lazyWriter.currClient = struct.id.client;
    lazyWriter.encoder.writeClient(struct.id.client);
    writeVarUint(lazyWriter.encoder.restEncoder, struct.id.clock + offset);
  }
  struct.write(lazyWriter.encoder, offset);
  lazyWriter.written++;
};
var finishLazyStructWriting = (lazyWriter) => {
  flushLazyStructWriter(lazyWriter);
  const restEncoder = lazyWriter.encoder.restEncoder;
  writeVarUint(restEncoder, lazyWriter.clientStructs.length);
  for (let i = 0; i < lazyWriter.clientStructs.length; i++) {
    const partStructs = lazyWriter.clientStructs[i];
    writeVarUint(restEncoder, partStructs.written);
    writeUint8Array(restEncoder, partStructs.restEncoder);
  }
};
var convertUpdateFormat = (update, blockTransformer, YDecoder, YEncoder) => {
  const updateDecoder = new YDecoder(createDecoder(update));
  const lazyDecoder = new LazyStructReader(updateDecoder, false);
  const updateEncoder = new YEncoder();
  const lazyWriter = new LazyStructWriter(updateEncoder);
  for (let curr = lazyDecoder.curr; curr !== null; curr = lazyDecoder.next()) {
    writeStructToLazyStructWriter(lazyWriter, blockTransformer(curr), 0);
  }
  finishLazyStructWriting(lazyWriter);
  const ds = readDeleteSet(updateDecoder);
  writeDeleteSet(updateEncoder, ds);
  return updateEncoder.toUint8Array();
};
var convertUpdateFormatV2ToV1 = (update) => convertUpdateFormat(update, id, UpdateDecoderV2, UpdateEncoderV1);
var errorComputeChanges = "You must not compute changes after the event-handler fired.";
var YEvent = class {
  /**
   * @param {T} target The changed type.
   * @param {Transaction} transaction
   */
  constructor(target, transaction) {
    this.target = target;
    this.currentTarget = target;
    this.transaction = transaction;
    this._changes = null;
    this._keys = null;
    this._delta = null;
    this._path = null;
  }
  /**
   * Computes the path from `y` to the changed type.
   *
   * @todo v14 should standardize on path: Array<{parent, index}> because that is easier to work with.
   *
   * The following property holds:
   * @example
   *   let type = y
   *   event.path.forEach(dir => {
   *     type = type.get(dir)
   *   })
   *   type === event.target // => true
   */
  get path() {
    return this._path || (this._path = getPathTo(this.currentTarget, this.target));
  }
  /**
   * Check if a struct is deleted by this event.
   *
   * In contrast to change.deleted, this method also returns true if the struct was added and then deleted.
   *
   * @param {AbstractStruct} struct
   * @return {boolean}
   */
  deletes(struct) {
    return isDeleted(this.transaction.deleteSet, struct.id);
  }
  /**
   * @type {Map<string, { action: 'add' | 'update' | 'delete', oldValue: any }>}
   */
  get keys() {
    if (this._keys === null) {
      if (this.transaction.doc._transactionCleanups.length === 0) {
        throw create3(errorComputeChanges);
      }
      const keys2 = /* @__PURE__ */ new Map();
      const target = this.target;
      const changed = (
        /** @type Set<string|null> */
        this.transaction.changed.get(target)
      );
      changed.forEach((key) => {
        if (key !== null) {
          const item = (
            /** @type {Item} */
            target._map.get(key)
          );
          let action;
          let oldValue;
          if (this.adds(item)) {
            let prev = item.left;
            while (prev !== null && this.adds(prev)) {
              prev = prev.left;
            }
            if (this.deletes(item)) {
              if (prev !== null && this.deletes(prev)) {
                action = "delete";
                oldValue = last(prev.content.getContent());
              } else {
                return;
              }
            } else {
              if (prev !== null && this.deletes(prev)) {
                action = "update";
                oldValue = last(prev.content.getContent());
              } else {
                action = "add";
                oldValue = void 0;
              }
            }
          } else {
            if (this.deletes(item)) {
              action = "delete";
              oldValue = last(
                /** @type {Item} */
                item.content.getContent()
              );
            } else {
              return;
            }
          }
          keys2.set(key, { action, oldValue });
        }
      });
      this._keys = keys2;
    }
    return this._keys;
  }
  /**
   * This is a computed property. Note that this can only be safely computed during the
   * event call. Computing this property after other changes happened might result in
   * unexpected behavior (incorrect computation of deltas). A safe way to collect changes
   * is to store the `changes` or the `delta` object. Avoid storing the `transaction` object.
   *
   * @type {Array<{insert?: string | Array<any> | object | AbstractType<any>, retain?: number, delete?: number, attributes?: Object<string, any>}>}
   */
  get delta() {
    return this.changes.delta;
  }
  /**
   * Check if a struct is added by this event.
   *
   * In contrast to change.deleted, this method also returns true if the struct was added and then deleted.
   *
   * @param {AbstractStruct} struct
   * @return {boolean}
   */
  adds(struct) {
    return struct.id.clock >= (this.transaction.beforeState.get(struct.id.client) || 0);
  }
  /**
   * This is a computed property. Note that this can only be safely computed during the
   * event call. Computing this property after other changes happened might result in
   * unexpected behavior (incorrect computation of deltas). A safe way to collect changes
   * is to store the `changes` or the `delta` object. Avoid storing the `transaction` object.
   *
   * @type {{added:Set<Item>,deleted:Set<Item>,keys:Map<string,{action:'add'|'update'|'delete',oldValue:any}>,delta:Array<{insert?:Array<any>|string, delete?:number, retain?:number}>}}
   */
  get changes() {
    let changes = this._changes;
    if (changes === null) {
      if (this.transaction.doc._transactionCleanups.length === 0) {
        throw create3(errorComputeChanges);
      }
      const target = this.target;
      const added = create2();
      const deleted = create2();
      const delta = [];
      changes = {
        added,
        deleted,
        delta,
        keys: this.keys
      };
      const changed = (
        /** @type Set<string|null> */
        this.transaction.changed.get(target)
      );
      if (changed.has(null)) {
        let lastOp = null;
        const packOp = () => {
          if (lastOp) {
            delta.push(lastOp);
          }
        };
        for (let item = target._start; item !== null; item = item.right) {
          if (item.deleted) {
            if (this.deletes(item) && !this.adds(item)) {
              if (lastOp === null || lastOp.delete === void 0) {
                packOp();
                lastOp = { delete: 0 };
              }
              lastOp.delete += item.length;
              deleted.add(item);
            }
          } else {
            if (this.adds(item)) {
              if (lastOp === null || lastOp.insert === void 0) {
                packOp();
                lastOp = { insert: [] };
              }
              lastOp.insert = lastOp.insert.concat(item.content.getContent());
              added.add(item);
            } else {
              if (lastOp === null || lastOp.retain === void 0) {
                packOp();
                lastOp = { retain: 0 };
              }
              lastOp.retain += item.length;
            }
          }
        }
        if (lastOp !== null && lastOp.retain === void 0) {
          packOp();
        }
      }
      this._changes = changes;
    }
    return (
      /** @type {any} */
      changes
    );
  }
};
var getPathTo = (parent, child) => {
  const path = [];
  while (child._item !== null && child !== parent) {
    if (child._item.parentSub !== null) {
      path.unshift(child._item.parentSub);
    } else {
      let i = 0;
      let c = (
        /** @type {AbstractType<any>} */
        child._item.parent._start
      );
      while (c !== child._item && c !== null) {
        if (!c.deleted && c.countable) {
          i += c.length;
        }
        c = c.right;
      }
      path.unshift(i);
    }
    child = /** @type {AbstractType<any>} */
    child._item.parent;
  }
  return path;
};
var warnPrematureAccess = () => {
  warn("Invalid access: Add Yjs type to a document before reading data.");
};
var maxSearchMarker = 80;
var globalSearchMarkerTimestamp = 0;
var ArraySearchMarker = class {
  /**
   * @param {Item} p
   * @param {number} index
   */
  constructor(p, index) {
    p.marker = true;
    this.p = p;
    this.index = index;
    this.timestamp = globalSearchMarkerTimestamp++;
  }
};
var refreshMarkerTimestamp = (marker) => {
  marker.timestamp = globalSearchMarkerTimestamp++;
};
var overwriteMarker = (marker, p, index) => {
  marker.p.marker = false;
  marker.p = p;
  p.marker = true;
  marker.index = index;
  marker.timestamp = globalSearchMarkerTimestamp++;
};
var markPosition = (searchMarker, p, index) => {
  if (searchMarker.length >= maxSearchMarker) {
    const marker = searchMarker.reduce((a, b) => a.timestamp < b.timestamp ? a : b);
    overwriteMarker(marker, p, index);
    return marker;
  } else {
    const pm = new ArraySearchMarker(p, index);
    searchMarker.push(pm);
    return pm;
  }
};
var findMarker = (yarray, index) => {
  if (yarray._start === null || index === 0 || yarray._searchMarker === null) {
    return null;
  }
  const marker = yarray._searchMarker.length === 0 ? null : yarray._searchMarker.reduce((a, b) => abs(index - a.index) < abs(index - b.index) ? a : b);
  let p = yarray._start;
  let pindex = 0;
  if (marker !== null) {
    p = marker.p;
    pindex = marker.index;
    refreshMarkerTimestamp(marker);
  }
  while (p.right !== null && pindex < index) {
    if (!p.deleted && p.countable) {
      if (index < pindex + p.length) {
        break;
      }
      pindex += p.length;
    }
    p = p.right;
  }
  while (p.left !== null && pindex > index) {
    p = p.left;
    if (!p.deleted && p.countable) {
      pindex -= p.length;
    }
  }
  while (p.left !== null && p.left.id.client === p.id.client && p.left.id.clock + p.left.length === p.id.clock) {
    p = p.left;
    if (!p.deleted && p.countable) {
      pindex -= p.length;
    }
  }
  if (marker !== null && abs(marker.index - pindex) < /** @type {YText|YArray<any>} */
  p.parent.length / maxSearchMarker) {
    overwriteMarker(marker, p, pindex);
    return marker;
  } else {
    return markPosition(yarray._searchMarker, p, pindex);
  }
};
var updateMarkerChanges = (searchMarker, index, len) => {
  for (let i = searchMarker.length - 1; i >= 0; i--) {
    const m = searchMarker[i];
    if (len > 0) {
      let p = m.p;
      p.marker = false;
      while (p && (p.deleted || !p.countable)) {
        p = p.left;
        if (p && !p.deleted && p.countable) {
          m.index -= p.length;
        }
      }
      if (p === null || p.marker === true) {
        searchMarker.splice(i, 1);
        continue;
      }
      m.p = p;
      p.marker = true;
    }
    if (index < m.index || len > 0 && index === m.index) {
      m.index = max(index, m.index + len);
    }
  }
};
var callTypeObservers = (type, transaction, event) => {
  const changedType = type;
  const changedParentTypes = transaction.changedParentTypes;
  while (true) {
    setIfUndefined(changedParentTypes, type, () => []).push(event);
    if (type._item === null) {
      break;
    }
    type = /** @type {AbstractType<any>} */
    type._item.parent;
  }
  callEventHandlerListeners(changedType._eH, event, transaction);
};
var AbstractType = class {
  constructor() {
    this._item = null;
    this._map = /* @__PURE__ */ new Map();
    this._start = null;
    this.doc = null;
    this._length = 0;
    this._eH = createEventHandler();
    this._dEH = createEventHandler();
    this._searchMarker = null;
  }
  /**
   * @return {AbstractType<any>|null}
   */
  get parent() {
    return this._item ? (
      /** @type {AbstractType<any>} */
      this._item.parent
    ) : null;
  }
  /**
   * Integrate this type into the Yjs instance.
   *
   * * Save this struct in the os
   * * This type is sent to other client
   * * Observer functions are fired
   *
   * @param {Doc} y The Yjs instance
   * @param {Item|null} item
   */
  _integrate(y, item) {
    this.doc = y;
    this._item = item;
  }
  /**
   * @return {AbstractType<EventType>}
   */
  _copy() {
    throw methodUnimplemented();
  }
  /**
   * Makes a copy of this data type that can be included somewhere else.
   *
   * Note that the content is only readable _after_ it has been included somewhere in the Ydoc.
   *
   * @return {AbstractType<EventType>}
   */
  clone() {
    throw methodUnimplemented();
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} _encoder
   */
  _write(_encoder) {
  }
  /**
   * The first non-deleted item
   */
  get _first() {
    let n = this._start;
    while (n !== null && n.deleted) {
      n = n.right;
    }
    return n;
  }
  /**
   * Creates YEvent and calls all type observers.
   * Must be implemented by each type.
   *
   * @param {Transaction} transaction
   * @param {Set<null|string>} _parentSubs Keys changed on this type. `null` if list was modified.
   */
  _callObserver(transaction, _parentSubs) {
    if (!transaction.local && this._searchMarker) {
      this._searchMarker.length = 0;
    }
  }
  /**
   * Observe all events that are created on this type.
   *
   * @param {function(EventType, Transaction):void} f Observer function
   */
  observe(f) {
    addEventHandlerListener(this._eH, f);
  }
  /**
   * Observe all events that are created by this type and its children.
   *
   * @param {function(Array<YEvent<any>>,Transaction):void} f Observer function
   */
  observeDeep(f) {
    addEventHandlerListener(this._dEH, f);
  }
  /**
   * Unregister an observer function.
   *
   * @param {function(EventType,Transaction):void} f Observer function
   */
  unobserve(f) {
    removeEventHandlerListener(this._eH, f);
  }
  /**
   * Unregister an observer function.
   *
   * @param {function(Array<YEvent<any>>,Transaction):void} f Observer function
   */
  unobserveDeep(f) {
    removeEventHandlerListener(this._dEH, f);
  }
  /**
   * @abstract
   * @return {any}
   */
  toJSON() {
  }
};
var typeListSlice = (type, start, end) => {
  type.doc ?? warnPrematureAccess();
  if (start < 0) {
    start = type._length + start;
  }
  if (end < 0) {
    end = type._length + end;
  }
  let len = end - start;
  const cs = [];
  let n = type._start;
  while (n !== null && len > 0) {
    if (n.countable && !n.deleted) {
      const c = n.content.getContent();
      if (c.length <= start) {
        start -= c.length;
      } else {
        for (let i = start; i < c.length && len > 0; i++) {
          cs.push(c[i]);
          len--;
        }
        start = 0;
      }
    }
    n = n.right;
  }
  return cs;
};
var typeListToArray = (type) => {
  type.doc ?? warnPrematureAccess();
  const cs = [];
  let n = type._start;
  while (n !== null) {
    if (n.countable && !n.deleted) {
      const c = n.content.getContent();
      for (let i = 0; i < c.length; i++) {
        cs.push(c[i]);
      }
    }
    n = n.right;
  }
  return cs;
};
var typeListForEach = (type, f) => {
  let index = 0;
  let n = type._start;
  type.doc ?? warnPrematureAccess();
  while (n !== null) {
    if (n.countable && !n.deleted) {
      const c = n.content.getContent();
      for (let i = 0; i < c.length; i++) {
        f(c[i], index++, type);
      }
    }
    n = n.right;
  }
};
var typeListMap = (type, f) => {
  const result = [];
  typeListForEach(type, (c, i) => {
    result.push(f(c, i, type));
  });
  return result;
};
var typeListCreateIterator = (type) => {
  let n = type._start;
  let currentContent = null;
  let currentContentIndex = 0;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next: () => {
      if (currentContent === null) {
        while (n !== null && n.deleted) {
          n = n.right;
        }
        if (n === null) {
          return {
            done: true,
            value: void 0
          };
        }
        currentContent = n.content.getContent();
        currentContentIndex = 0;
        n = n.right;
      }
      const value = currentContent[currentContentIndex++];
      if (currentContent.length <= currentContentIndex) {
        currentContent = null;
      }
      return {
        done: false,
        value
      };
    }
  };
};
var typeListGet = (type, index) => {
  type.doc ?? warnPrematureAccess();
  const marker = findMarker(type, index);
  let n = type._start;
  if (marker !== null) {
    n = marker.p;
    index -= marker.index;
  }
  for (; n !== null; n = n.right) {
    if (!n.deleted && n.countable) {
      if (index < n.length) {
        return n.content.getContent()[index];
      }
      index -= n.length;
    }
  }
};
var typeListInsertGenericsAfter = (transaction, parent, referenceItem, content) => {
  let left = referenceItem;
  const doc2 = transaction.doc;
  const ownClientId = doc2.clientID;
  const store = doc2.store;
  const right = referenceItem === null ? parent._start : referenceItem.right;
  let jsonContent = [];
  const packJsonContent = () => {
    if (jsonContent.length > 0) {
      left = new Item(createID(ownClientId, getState(store, ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, new ContentAny(jsonContent));
      left.integrate(transaction, 0);
      jsonContent = [];
    }
  };
  content.forEach((c) => {
    if (c === null) {
      jsonContent.push(c);
    } else {
      switch (c.constructor) {
        case Number:
        case Object:
        case Boolean:
        case Array:
        case String:
          jsonContent.push(c);
          break;
        default:
          packJsonContent();
          switch (c.constructor) {
            case Uint8Array:
            case ArrayBuffer:
              left = new Item(createID(ownClientId, getState(store, ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, new ContentBinary(new Uint8Array(
                /** @type {Uint8Array} */
                c
              )));
              left.integrate(transaction, 0);
              break;
            case Doc:
              left = new Item(createID(ownClientId, getState(store, ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, new ContentDoc(
                /** @type {Doc} */
                c
              ));
              left.integrate(transaction, 0);
              break;
            default:
              if (c instanceof AbstractType) {
                left = new Item(createID(ownClientId, getState(store, ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, new ContentType(c));
                left.integrate(transaction, 0);
              } else {
                throw new Error("Unexpected content type in insert operation");
              }
          }
      }
    }
  });
  packJsonContent();
};
var lengthExceeded = () => create3("Length exceeded!");
var typeListInsertGenerics = (transaction, parent, index, content) => {
  if (index > parent._length) {
    throw lengthExceeded();
  }
  if (index === 0) {
    if (parent._searchMarker) {
      updateMarkerChanges(parent._searchMarker, index, content.length);
    }
    return typeListInsertGenericsAfter(transaction, parent, null, content);
  }
  const startIndex = index;
  const marker = findMarker(parent, index);
  let n = parent._start;
  if (marker !== null) {
    n = marker.p;
    index -= marker.index;
    if (index === 0) {
      n = n.prev;
      index += n && n.countable && !n.deleted ? n.length : 0;
    }
  }
  for (; n !== null; n = n.right) {
    if (!n.deleted && n.countable) {
      if (index <= n.length) {
        if (index < n.length) {
          getItemCleanStart(transaction, createID(n.id.client, n.id.clock + index));
        }
        break;
      }
      index -= n.length;
    }
  }
  if (parent._searchMarker) {
    updateMarkerChanges(parent._searchMarker, startIndex, content.length);
  }
  return typeListInsertGenericsAfter(transaction, parent, n, content);
};
var typeListPushGenerics = (transaction, parent, content) => {
  const marker = (parent._searchMarker || []).reduce((maxMarker, currMarker) => currMarker.index > maxMarker.index ? currMarker : maxMarker, { index: 0, p: parent._start });
  let n = marker.p;
  if (n) {
    while (n.right) {
      n = n.right;
    }
  }
  return typeListInsertGenericsAfter(transaction, parent, n, content);
};
var typeListDelete = (transaction, parent, index, length2) => {
  if (length2 === 0) {
    return;
  }
  const startIndex = index;
  const startLength = length2;
  const marker = findMarker(parent, index);
  let n = parent._start;
  if (marker !== null) {
    n = marker.p;
    index -= marker.index;
  }
  for (; n !== null && index > 0; n = n.right) {
    if (!n.deleted && n.countable) {
      if (index < n.length) {
        getItemCleanStart(transaction, createID(n.id.client, n.id.clock + index));
      }
      index -= n.length;
    }
  }
  while (length2 > 0 && n !== null) {
    if (!n.deleted) {
      if (length2 < n.length) {
        getItemCleanStart(transaction, createID(n.id.client, n.id.clock + length2));
      }
      n.delete(transaction);
      length2 -= n.length;
    }
    n = n.right;
  }
  if (length2 > 0) {
    throw lengthExceeded();
  }
  if (parent._searchMarker) {
    updateMarkerChanges(
      parent._searchMarker,
      startIndex,
      -startLength + length2
      /* in case we remove the above exception */
    );
  }
};
var typeMapDelete = (transaction, parent, key) => {
  const c = parent._map.get(key);
  if (c !== void 0) {
    c.delete(transaction);
  }
};
var typeMapSet = (transaction, parent, key, value) => {
  const left = parent._map.get(key) || null;
  const doc2 = transaction.doc;
  const ownClientId = doc2.clientID;
  let content;
  if (value == null) {
    content = new ContentAny([value]);
  } else {
    switch (value.constructor) {
      case Number:
      case Object:
      case Boolean:
      case Array:
      case String:
      case Date:
      case BigInt:
        content = new ContentAny([value]);
        break;
      case Uint8Array:
        content = new ContentBinary(
          /** @type {Uint8Array} */
          value
        );
        break;
      case Doc:
        content = new ContentDoc(
          /** @type {Doc} */
          value
        );
        break;
      default:
        if (value instanceof AbstractType) {
          content = new ContentType(value);
        } else {
          throw new Error("Unexpected content type");
        }
    }
  }
  new Item(createID(ownClientId, getState(doc2.store, ownClientId)), left, left && left.lastId, null, null, parent, key, content).integrate(transaction, 0);
};
var typeMapGet = (parent, key) => {
  parent.doc ?? warnPrematureAccess();
  const val = parent._map.get(key);
  return val !== void 0 && !val.deleted ? val.content.getContent()[val.length - 1] : void 0;
};
var typeMapGetAll = (parent) => {
  const res = {};
  parent.doc ?? warnPrematureAccess();
  parent._map.forEach((value, key) => {
    if (!value.deleted) {
      res[key] = value.content.getContent()[value.length - 1];
    }
  });
  return res;
};
var typeMapHas = (parent, key) => {
  parent.doc ?? warnPrematureAccess();
  const val = parent._map.get(key);
  return val !== void 0 && !val.deleted;
};
var typeMapGetAllSnapshot = (parent, snapshot) => {
  const res = {};
  parent._map.forEach((value, key) => {
    let v = value;
    while (v !== null && (!snapshot.sv.has(v.id.client) || v.id.clock >= (snapshot.sv.get(v.id.client) || 0))) {
      v = v.left;
    }
    if (v !== null && isVisible(v, snapshot)) {
      res[key] = v.content.getContent()[v.length - 1];
    }
  });
  return res;
};
var createMapIterator = (type) => {
  type.doc ?? warnPrematureAccess();
  return iteratorFilter(
    type._map.entries(),
    /** @param {any} entry */
    (entry) => !entry[1].deleted
  );
};
var YArrayEvent = class extends YEvent {
};
var YArray = class _YArray extends AbstractType {
  constructor() {
    super();
    this._prelimContent = [];
    this._searchMarker = [];
  }
  /**
   * Construct a new YArray containing the specified items.
   * @template {Object<string,any>|Array<any>|number|null|string|Uint8Array} T
   * @param {Array<T>} items
   * @return {YArray<T>}
   */
  static from(items) {
    const a = new _YArray();
    a.push(items);
    return a;
  }
  /**
   * Integrate this type into the Yjs instance.
   *
   * * Save this struct in the os
   * * This type is sent to other client
   * * Observer functions are fired
   *
   * @param {Doc} y The Yjs instance
   * @param {Item} item
   */
  _integrate(y, item) {
    super._integrate(y, item);
    this.insert(
      0,
      /** @type {Array<any>} */
      this._prelimContent
    );
    this._prelimContent = null;
  }
  /**
   * @return {YArray<T>}
   */
  _copy() {
    return new _YArray();
  }
  /**
   * Makes a copy of this data type that can be included somewhere else.
   *
   * Note that the content is only readable _after_ it has been included somewhere in the Ydoc.
   *
   * @return {YArray<T>}
   */
  clone() {
    const arr = new _YArray();
    arr.insert(0, this.toArray().map(
      (el) => el instanceof AbstractType ? (
        /** @type {typeof el} */
        el.clone()
      ) : el
    ));
    return arr;
  }
  get length() {
    this.doc ?? warnPrematureAccess();
    return this._length;
  }
  /**
   * Creates YArrayEvent and calls observers.
   *
   * @param {Transaction} transaction
   * @param {Set<null|string>} parentSubs Keys changed on this type. `null` if list was modified.
   */
  _callObserver(transaction, parentSubs) {
    super._callObserver(transaction, parentSubs);
    callTypeObservers(this, transaction, new YArrayEvent(this, transaction));
  }
  /**
   * Inserts new content at an index.
   *
   * Important: This function expects an array of content. Not just a content
   * object. The reason for this "weirdness" is that inserting several elements
   * is very efficient when it is done as a single operation.
   *
   * @example
   *  // Insert character 'a' at position 0
   *  yarray.insert(0, ['a'])
   *  // Insert numbers 1, 2 at position 1
   *  yarray.insert(1, [1, 2])
   *
   * @param {number} index The index to insert content at.
   * @param {Array<T>} content The array of content
   */
  insert(index, content) {
    if (this.doc !== null) {
      transact(this.doc, (transaction) => {
        typeListInsertGenerics(
          transaction,
          this,
          index,
          /** @type {any} */
          content
        );
      });
    } else {
      this._prelimContent.splice(index, 0, ...content);
    }
  }
  /**
   * Appends content to this YArray.
   *
   * @param {Array<T>} content Array of content to append.
   *
   * @todo Use the following implementation in all types.
   */
  push(content) {
    if (this.doc !== null) {
      transact(this.doc, (transaction) => {
        typeListPushGenerics(
          transaction,
          this,
          /** @type {any} */
          content
        );
      });
    } else {
      this._prelimContent.push(...content);
    }
  }
  /**
   * Prepends content to this YArray.
   *
   * @param {Array<T>} content Array of content to prepend.
   */
  unshift(content) {
    this.insert(0, content);
  }
  /**
   * Deletes elements starting from an index.
   *
   * @param {number} index Index at which to start deleting elements
   * @param {number} length The number of elements to remove. Defaults to 1.
   */
  delete(index, length2 = 1) {
    if (this.doc !== null) {
      transact(this.doc, (transaction) => {
        typeListDelete(transaction, this, index, length2);
      });
    } else {
      this._prelimContent.splice(index, length2);
    }
  }
  /**
   * Returns the i-th element from a YArray.
   *
   * @param {number} index The index of the element to return from the YArray
   * @return {T}
   */
  get(index) {
    return typeListGet(this, index);
  }
  /**
   * Transforms this YArray to a JavaScript Array.
   *
   * @return {Array<T>}
   */
  toArray() {
    return typeListToArray(this);
  }
  /**
   * Returns a portion of this YArray into a JavaScript Array selected
   * from start to end (end not included).
   *
   * @param {number} [start]
   * @param {number} [end]
   * @return {Array<T>}
   */
  slice(start = 0, end = this.length) {
    return typeListSlice(this, start, end);
  }
  /**
   * Transforms this Shared Type to a JSON object.
   *
   * @return {Array<any>}
   */
  toJSON() {
    return this.map((c) => c instanceof AbstractType ? c.toJSON() : c);
  }
  /**
   * Returns an Array with the result of calling a provided function on every
   * element of this YArray.
   *
   * @template M
   * @param {function(T,number,YArray<T>):M} f Function that produces an element of the new Array
   * @return {Array<M>} A new array with each element being the result of the
   *                 callback function
   */
  map(f) {
    return typeListMap(
      this,
      /** @type {any} */
      f
    );
  }
  /**
   * Executes a provided function once on every element of this YArray.
   *
   * @param {function(T,number,YArray<T>):void} f A function to execute on every element of this YArray.
   */
  forEach(f) {
    typeListForEach(this, f);
  }
  /**
   * @return {IterableIterator<T>}
   */
  [Symbol.iterator]() {
    return typeListCreateIterator(this);
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   */
  _write(encoder2) {
    encoder2.writeTypeRef(YArrayRefID);
  }
};
var readYArray = (_decoder) => new YArray();
var YMapEvent = class extends YEvent {
  /**
   * @param {YMap<T>} ymap The YArray that changed.
   * @param {Transaction} transaction
   * @param {Set<any>} subs The keys that changed.
   */
  constructor(ymap, transaction, subs) {
    super(ymap, transaction);
    this.keysChanged = subs;
  }
};
var YMap = class _YMap extends AbstractType {
  /**
   *
   * @param {Iterable<readonly [string, any]>=} entries - an optional iterable to initialize the YMap
   */
  constructor(entries) {
    super();
    this._prelimContent = null;
    if (entries === void 0) {
      this._prelimContent = /* @__PURE__ */ new Map();
    } else {
      this._prelimContent = new Map(entries);
    }
  }
  /**
   * Integrate this type into the Yjs instance.
   *
   * * Save this struct in the os
   * * This type is sent to other client
   * * Observer functions are fired
   *
   * @param {Doc} y The Yjs instance
   * @param {Item} item
   */
  _integrate(y, item) {
    super._integrate(y, item);
    this._prelimContent.forEach((value, key) => {
      this.set(key, value);
    });
    this._prelimContent = null;
  }
  /**
   * @return {YMap<MapType>}
   */
  _copy() {
    return new _YMap();
  }
  /**
   * Makes a copy of this data type that can be included somewhere else.
   *
   * Note that the content is only readable _after_ it has been included somewhere in the Ydoc.
   *
   * @return {YMap<MapType>}
   */
  clone() {
    const map2 = new _YMap();
    this.forEach((value, key) => {
      map2.set(key, value instanceof AbstractType ? (
        /** @type {typeof value} */
        value.clone()
      ) : value);
    });
    return map2;
  }
  /**
   * Creates YMapEvent and calls observers.
   *
   * @param {Transaction} transaction
   * @param {Set<null|string>} parentSubs Keys changed on this type. `null` if list was modified.
   */
  _callObserver(transaction, parentSubs) {
    callTypeObservers(this, transaction, new YMapEvent(this, transaction, parentSubs));
  }
  /**
   * Transforms this Shared Type to a JSON object.
   *
   * @return {Object<string,any>}
   */
  toJSON() {
    this.doc ?? warnPrematureAccess();
    const map2 = {};
    this._map.forEach((item, key) => {
      if (!item.deleted) {
        const v = item.content.getContent()[item.length - 1];
        map2[key] = v instanceof AbstractType ? v.toJSON() : v;
      }
    });
    return map2;
  }
  /**
   * Returns the size of the YMap (count of key/value pairs)
   *
   * @return {number}
   */
  get size() {
    return [...createMapIterator(this)].length;
  }
  /**
   * Returns the keys for each element in the YMap Type.
   *
   * @return {IterableIterator<string>}
   */
  keys() {
    return iteratorMap(
      createMapIterator(this),
      /** @param {any} v */
      (v) => v[0]
    );
  }
  /**
   * Returns the values for each element in the YMap Type.
   *
   * @return {IterableIterator<MapType>}
   */
  values() {
    return iteratorMap(
      createMapIterator(this),
      /** @param {any} v */
      (v) => v[1].content.getContent()[v[1].length - 1]
    );
  }
  /**
   * Returns an Iterator of [key, value] pairs
   *
   * @return {IterableIterator<[string, MapType]>}
   */
  entries() {
    return iteratorMap(
      createMapIterator(this),
      /** @param {any} v */
      (v) => (
        /** @type {any} */
        [v[0], v[1].content.getContent()[v[1].length - 1]]
      )
    );
  }
  /**
   * Executes a provided function on once on every key-value pair.
   *
   * @param {function(MapType,string,YMap<MapType>):void} f A function to execute on every element of this YArray.
   */
  forEach(f) {
    this.doc ?? warnPrematureAccess();
    this._map.forEach((item, key) => {
      if (!item.deleted) {
        f(item.content.getContent()[item.length - 1], key, this);
      }
    });
  }
  /**
   * Returns an Iterator of [key, value] pairs
   *
   * @return {IterableIterator<[string, MapType]>}
   */
  [Symbol.iterator]() {
    return this.entries();
  }
  /**
   * Remove a specified element from this YMap.
   *
   * @param {string} key The key of the element to remove.
   */
  delete(key) {
    if (this.doc !== null) {
      transact(this.doc, (transaction) => {
        typeMapDelete(transaction, this, key);
      });
    } else {
      this._prelimContent.delete(key);
    }
  }
  /**
   * Adds or updates an element with a specified key and value.
   * @template {MapType} VAL
   *
   * @param {string} key The key of the element to add to this YMap
   * @param {VAL} value The value of the element to add
   * @return {VAL}
   */
  set(key, value) {
    if (this.doc !== null) {
      transact(this.doc, (transaction) => {
        typeMapSet(
          transaction,
          this,
          key,
          /** @type {any} */
          value
        );
      });
    } else {
      this._prelimContent.set(key, value);
    }
    return value;
  }
  /**
   * Returns a specified element from this YMap.
   *
   * @param {string} key
   * @return {MapType|undefined}
   */
  get(key) {
    return (
      /** @type {any} */
      typeMapGet(this, key)
    );
  }
  /**
   * Returns a boolean indicating whether the specified key exists or not.
   *
   * @param {string} key The key to test.
   * @return {boolean}
   */
  has(key) {
    return typeMapHas(this, key);
  }
  /**
   * Removes all elements from this YMap.
   */
  clear() {
    if (this.doc !== null) {
      transact(this.doc, (transaction) => {
        this.forEach(function(_value, key, map2) {
          typeMapDelete(transaction, map2, key);
        });
      });
    } else {
      this._prelimContent.clear();
    }
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   */
  _write(encoder2) {
    encoder2.writeTypeRef(YMapRefID);
  }
};
var readYMap = (_decoder) => new YMap();
var equalAttrs = (a, b) => a === b || typeof a === "object" && typeof b === "object" && a && b && equalFlat(a, b);
var ItemTextListPosition = class {
  /**
   * @param {Item|null} left
   * @param {Item|null} right
   * @param {number} index
   * @param {Map<string,any>} currentAttributes
   */
  constructor(left, right, index, currentAttributes) {
    this.left = left;
    this.right = right;
    this.index = index;
    this.currentAttributes = currentAttributes;
  }
  /**
   * Only call this if you know that this.right is defined
   */
  forward() {
    if (this.right === null) {
      unexpectedCase();
    }
    switch (this.right.content.constructor) {
      case ContentFormat:
        if (!this.right.deleted) {
          updateCurrentAttributes(
            this.currentAttributes,
            /** @type {ContentFormat} */
            this.right.content
          );
        }
        break;
      default:
        if (!this.right.deleted) {
          this.index += this.right.length;
        }
        break;
    }
    this.left = this.right;
    this.right = this.right.right;
  }
};
var findNextPosition = (transaction, pos, count) => {
  while (pos.right !== null && count > 0) {
    switch (pos.right.content.constructor) {
      case ContentFormat:
        if (!pos.right.deleted) {
          updateCurrentAttributes(
            pos.currentAttributes,
            /** @type {ContentFormat} */
            pos.right.content
          );
        }
        break;
      default:
        if (!pos.right.deleted) {
          if (count < pos.right.length) {
            getItemCleanStart(transaction, createID(pos.right.id.client, pos.right.id.clock + count));
          }
          pos.index += pos.right.length;
          count -= pos.right.length;
        }
        break;
    }
    pos.left = pos.right;
    pos.right = pos.right.right;
  }
  return pos;
};
var findPosition = (transaction, parent, index, useSearchMarker) => {
  const currentAttributes = /* @__PURE__ */ new Map();
  const marker = useSearchMarker ? findMarker(parent, index) : null;
  if (marker) {
    const pos = new ItemTextListPosition(marker.p.left, marker.p, marker.index, currentAttributes);
    return findNextPosition(transaction, pos, index - marker.index);
  } else {
    const pos = new ItemTextListPosition(null, parent._start, 0, currentAttributes);
    return findNextPosition(transaction, pos, index);
  }
};
var insertNegatedAttributes = (transaction, parent, currPos, negatedAttributes) => {
  while (currPos.right !== null && (currPos.right.deleted === true || currPos.right.content.constructor === ContentFormat && equalAttrs(
    negatedAttributes.get(
      /** @type {ContentFormat} */
      currPos.right.content.key
    ),
    /** @type {ContentFormat} */
    currPos.right.content.value
  ))) {
    if (!currPos.right.deleted) {
      negatedAttributes.delete(
        /** @type {ContentFormat} */
        currPos.right.content.key
      );
    }
    currPos.forward();
  }
  const doc2 = transaction.doc;
  const ownClientId = doc2.clientID;
  negatedAttributes.forEach((val, key) => {
    const left = currPos.left;
    const right = currPos.right;
    const nextFormat = new Item(createID(ownClientId, getState(doc2.store, ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, new ContentFormat(key, val));
    nextFormat.integrate(transaction, 0);
    currPos.right = nextFormat;
    currPos.forward();
  });
};
var updateCurrentAttributes = (currentAttributes, format) => {
  const { key, value } = format;
  if (value === null) {
    currentAttributes.delete(key);
  } else {
    currentAttributes.set(key, value);
  }
};
var minimizeAttributeChanges = (currPos, attributes) => {
  while (true) {
    if (currPos.right === null) {
      break;
    } else if (currPos.right.deleted || currPos.right.content.constructor === ContentFormat && equalAttrs(
      attributes[
        /** @type {ContentFormat} */
        currPos.right.content.key
      ] ?? null,
      /** @type {ContentFormat} */
      currPos.right.content.value
    )) ;
    else {
      break;
    }
    currPos.forward();
  }
};
var insertAttributes = (transaction, parent, currPos, attributes) => {
  const doc2 = transaction.doc;
  const ownClientId = doc2.clientID;
  const negatedAttributes = /* @__PURE__ */ new Map();
  for (const key in attributes) {
    const val = attributes[key];
    const currentVal = currPos.currentAttributes.get(key) ?? null;
    if (!equalAttrs(currentVal, val)) {
      negatedAttributes.set(key, currentVal);
      const { left, right } = currPos;
      currPos.right = new Item(createID(ownClientId, getState(doc2.store, ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, new ContentFormat(key, val));
      currPos.right.integrate(transaction, 0);
      currPos.forward();
    }
  }
  return negatedAttributes;
};
var insertText = (transaction, parent, currPos, text2, attributes) => {
  currPos.currentAttributes.forEach((_val, key) => {
    if (attributes[key] === void 0) {
      attributes[key] = null;
    }
  });
  const doc2 = transaction.doc;
  const ownClientId = doc2.clientID;
  minimizeAttributeChanges(currPos, attributes);
  const negatedAttributes = insertAttributes(transaction, parent, currPos, attributes);
  const content = text2.constructor === String ? new ContentString(
    /** @type {string} */
    text2
  ) : text2 instanceof AbstractType ? new ContentType(text2) : new ContentEmbed(text2);
  let { left, right, index } = currPos;
  if (parent._searchMarker) {
    updateMarkerChanges(parent._searchMarker, currPos.index, content.getLength());
  }
  right = new Item(createID(ownClientId, getState(doc2.store, ownClientId)), left, left && left.lastId, right, right && right.id, parent, null, content);
  right.integrate(transaction, 0);
  currPos.right = right;
  currPos.index = index;
  currPos.forward();
  insertNegatedAttributes(transaction, parent, currPos, negatedAttributes);
};
var formatText = (transaction, parent, currPos, length2, attributes) => {
  const doc2 = transaction.doc;
  const ownClientId = doc2.clientID;
  minimizeAttributeChanges(currPos, attributes);
  const negatedAttributes = insertAttributes(transaction, parent, currPos, attributes);
  iterationLoop: while (currPos.right !== null && (length2 > 0 || negatedAttributes.size > 0 && (currPos.right.deleted || currPos.right.content.constructor === ContentFormat))) {
    if (!currPos.right.deleted) {
      switch (currPos.right.content.constructor) {
        case ContentFormat: {
          const { key, value } = (
            /** @type {ContentFormat} */
            currPos.right.content
          );
          const attr = attributes[key];
          if (attr !== void 0) {
            if (equalAttrs(attr, value)) {
              negatedAttributes.delete(key);
            } else {
              if (length2 === 0) {
                break iterationLoop;
              }
              negatedAttributes.set(key, value);
            }
            currPos.right.delete(transaction);
          } else {
            currPos.currentAttributes.set(key, value);
          }
          break;
        }
        default:
          if (length2 < currPos.right.length) {
            getItemCleanStart(transaction, createID(currPos.right.id.client, currPos.right.id.clock + length2));
          }
          length2 -= currPos.right.length;
          break;
      }
    }
    currPos.forward();
  }
  if (length2 > 0) {
    let newlines = "";
    for (; length2 > 0; length2--) {
      newlines += "\n";
    }
    currPos.right = new Item(createID(ownClientId, getState(doc2.store, ownClientId)), currPos.left, currPos.left && currPos.left.lastId, currPos.right, currPos.right && currPos.right.id, parent, null, new ContentString(newlines));
    currPos.right.integrate(transaction, 0);
    currPos.forward();
  }
  insertNegatedAttributes(transaction, parent, currPos, negatedAttributes);
};
var cleanupFormattingGap = (transaction, start, curr, startAttributes, currAttributes) => {
  let end = start;
  const endFormats = create();
  while (end && (!end.countable || end.deleted)) {
    if (!end.deleted && end.content.constructor === ContentFormat) {
      const cf = (
        /** @type {ContentFormat} */
        end.content
      );
      endFormats.set(cf.key, cf);
    }
    end = end.right;
  }
  let cleanups = 0;
  let reachedCurr = false;
  while (start !== end) {
    if (curr === start) {
      reachedCurr = true;
    }
    if (!start.deleted) {
      const content = start.content;
      switch (content.constructor) {
        case ContentFormat: {
          const { key, value } = (
            /** @type {ContentFormat} */
            content
          );
          const startAttrValue = startAttributes.get(key) ?? null;
          if (endFormats.get(key) !== content || startAttrValue === value) {
            start.delete(transaction);
            cleanups++;
            if (!reachedCurr && (currAttributes.get(key) ?? null) === value && startAttrValue !== value) {
              if (startAttrValue === null) {
                currAttributes.delete(key);
              } else {
                currAttributes.set(key, startAttrValue);
              }
            }
          }
          if (!reachedCurr && !start.deleted) {
            updateCurrentAttributes(
              currAttributes,
              /** @type {ContentFormat} */
              content
            );
          }
          break;
        }
      }
    }
    start = /** @type {Item} */
    start.right;
  }
  return cleanups;
};
var cleanupContextlessFormattingGap = (transaction, item) => {
  while (item && item.right && (item.right.deleted || !item.right.countable)) {
    item = item.right;
  }
  const attrs = /* @__PURE__ */ new Set();
  while (item && (item.deleted || !item.countable)) {
    if (!item.deleted && item.content.constructor === ContentFormat) {
      const key = (
        /** @type {ContentFormat} */
        item.content.key
      );
      if (attrs.has(key)) {
        item.delete(transaction);
      } else {
        attrs.add(key);
      }
    }
    item = item.left;
  }
};
var cleanupYTextFormatting = (type) => {
  let res = 0;
  transact(
    /** @type {Doc} */
    type.doc,
    (transaction) => {
      let start = (
        /** @type {Item} */
        type._start
      );
      let end = type._start;
      let startAttributes = create();
      const currentAttributes = copy(startAttributes);
      while (end) {
        if (end.deleted === false) {
          switch (end.content.constructor) {
            case ContentFormat:
              updateCurrentAttributes(
                currentAttributes,
                /** @type {ContentFormat} */
                end.content
              );
              break;
            default:
              res += cleanupFormattingGap(transaction, start, end, startAttributes, currentAttributes);
              startAttributes = copy(currentAttributes);
              start = end;
              break;
          }
        }
        end = end.right;
      }
    }
  );
  return res;
};
var cleanupYTextAfterTransaction = (transaction) => {
  const needFullCleanup = /* @__PURE__ */ new Set();
  const doc2 = transaction.doc;
  for (const [client, afterClock] of transaction.afterState.entries()) {
    const clock = transaction.beforeState.get(client) || 0;
    if (afterClock === clock) {
      continue;
    }
    iterateStructs(
      transaction,
      /** @type {Array<Item|GC>} */
      doc2.store.clients.get(client),
      clock,
      afterClock,
      (item) => {
        if (!item.deleted && /** @type {Item} */
        item.content.constructor === ContentFormat && item.constructor !== GC) {
          needFullCleanup.add(
            /** @type {any} */
            item.parent
          );
        }
      }
    );
  }
  transact(doc2, (t) => {
    iterateDeletedStructs(transaction, transaction.deleteSet, (item) => {
      if (item instanceof GC || !/** @type {YText} */
      item.parent._hasFormatting || needFullCleanup.has(
        /** @type {YText} */
        item.parent
      )) {
        return;
      }
      const parent = (
        /** @type {YText} */
        item.parent
      );
      if (item.content.constructor === ContentFormat) {
        needFullCleanup.add(parent);
      } else {
        cleanupContextlessFormattingGap(t, item);
      }
    });
    for (const yText of needFullCleanup) {
      cleanupYTextFormatting(yText);
    }
  });
};
var deleteText = (transaction, currPos, length2) => {
  const startLength = length2;
  const startAttrs = copy(currPos.currentAttributes);
  const start = currPos.right;
  while (length2 > 0 && currPos.right !== null) {
    if (currPos.right.deleted === false) {
      switch (currPos.right.content.constructor) {
        case ContentType:
        case ContentEmbed:
        case ContentString:
          if (length2 < currPos.right.length) {
            getItemCleanStart(transaction, createID(currPos.right.id.client, currPos.right.id.clock + length2));
          }
          length2 -= currPos.right.length;
          currPos.right.delete(transaction);
          break;
      }
    }
    currPos.forward();
  }
  if (start) {
    cleanupFormattingGap(transaction, start, currPos.right, startAttrs, currPos.currentAttributes);
  }
  const parent = (
    /** @type {AbstractType<any>} */
    /** @type {Item} */
    (currPos.left || currPos.right).parent
  );
  if (parent._searchMarker) {
    updateMarkerChanges(parent._searchMarker, currPos.index, -startLength + length2);
  }
  return currPos;
};
var YTextEvent = class extends YEvent {
  /**
   * @param {YText} ytext
   * @param {Transaction} transaction
   * @param {Set<any>} subs The keys that changed
   */
  constructor(ytext, transaction, subs) {
    super(ytext, transaction);
    this.childListChanged = false;
    this.keysChanged = /* @__PURE__ */ new Set();
    subs.forEach((sub) => {
      if (sub === null) {
        this.childListChanged = true;
      } else {
        this.keysChanged.add(sub);
      }
    });
  }
  /**
   * @type {{added:Set<Item>,deleted:Set<Item>,keys:Map<string,{action:'add'|'update'|'delete',oldValue:any}>,delta:Array<{insert?:Array<any>|string, delete?:number, retain?:number}>}}
   */
  get changes() {
    if (this._changes === null) {
      const changes = {
        keys: this.keys,
        delta: this.delta,
        added: /* @__PURE__ */ new Set(),
        deleted: /* @__PURE__ */ new Set()
      };
      this._changes = changes;
    }
    return (
      /** @type {any} */
      this._changes
    );
  }
  /**
   * Compute the changes in the delta format.
   * A {@link https://quilljs.com/docs/delta/|Quill Delta}) that represents the changes on the document.
   *
   * @type {Array<{insert?:string|object|AbstractType<any>, delete?:number, retain?:number, attributes?: Object<string,any>}>}
   *
   * @public
   */
  get delta() {
    if (this._delta === null) {
      const y = (
        /** @type {Doc} */
        this.target.doc
      );
      const delta = [];
      transact(y, (transaction) => {
        const currentAttributes = /* @__PURE__ */ new Map();
        const oldAttributes = /* @__PURE__ */ new Map();
        let item = this.target._start;
        let action = null;
        const attributes = {};
        let insert = "";
        let retain = 0;
        let deleteLen = 0;
        const addOp = () => {
          if (action !== null) {
            let op = null;
            switch (action) {
              case "delete":
                if (deleteLen > 0) {
                  op = { delete: deleteLen };
                }
                deleteLen = 0;
                break;
              case "insert":
                if (typeof insert === "object" || insert.length > 0) {
                  op = { insert };
                  if (currentAttributes.size > 0) {
                    op.attributes = {};
                    currentAttributes.forEach((value, key) => {
                      if (value !== null) {
                        op.attributes[key] = value;
                      }
                    });
                  }
                }
                insert = "";
                break;
              case "retain":
                if (retain > 0) {
                  op = { retain };
                  if (!isEmpty(attributes)) {
                    op.attributes = assign({}, attributes);
                  }
                }
                retain = 0;
                break;
            }
            if (op) delta.push(op);
            action = null;
          }
        };
        while (item !== null) {
          switch (item.content.constructor) {
            case ContentType:
            case ContentEmbed:
              if (this.adds(item)) {
                if (!this.deletes(item)) {
                  addOp();
                  action = "insert";
                  insert = item.content.getContent()[0];
                  addOp();
                }
              } else if (this.deletes(item)) {
                if (action !== "delete") {
                  addOp();
                  action = "delete";
                }
                deleteLen += 1;
              } else if (!item.deleted) {
                if (action !== "retain") {
                  addOp();
                  action = "retain";
                }
                retain += 1;
              }
              break;
            case ContentString:
              if (this.adds(item)) {
                if (!this.deletes(item)) {
                  if (action !== "insert") {
                    addOp();
                    action = "insert";
                  }
                  insert += /** @type {ContentString} */
                  item.content.str;
                }
              } else if (this.deletes(item)) {
                if (action !== "delete") {
                  addOp();
                  action = "delete";
                }
                deleteLen += item.length;
              } else if (!item.deleted) {
                if (action !== "retain") {
                  addOp();
                  action = "retain";
                }
                retain += item.length;
              }
              break;
            case ContentFormat: {
              const { key, value } = (
                /** @type {ContentFormat} */
                item.content
              );
              if (this.adds(item)) {
                if (!this.deletes(item)) {
                  const curVal = currentAttributes.get(key) ?? null;
                  if (!equalAttrs(curVal, value)) {
                    if (action === "retain") {
                      addOp();
                    }
                    if (equalAttrs(value, oldAttributes.get(key) ?? null)) {
                      delete attributes[key];
                    } else {
                      attributes[key] = value;
                    }
                  } else if (value !== null) {
                    item.delete(transaction);
                  }
                }
              } else if (this.deletes(item)) {
                oldAttributes.set(key, value);
                const curVal = currentAttributes.get(key) ?? null;
                if (!equalAttrs(curVal, value)) {
                  if (action === "retain") {
                    addOp();
                  }
                  attributes[key] = curVal;
                }
              } else if (!item.deleted) {
                oldAttributes.set(key, value);
                const attr = attributes[key];
                if (attr !== void 0) {
                  if (!equalAttrs(attr, value)) {
                    if (action === "retain") {
                      addOp();
                    }
                    if (value === null) {
                      delete attributes[key];
                    } else {
                      attributes[key] = value;
                    }
                  } else if (attr !== null) {
                    item.delete(transaction);
                  }
                }
              }
              if (!item.deleted) {
                if (action === "insert") {
                  addOp();
                }
                updateCurrentAttributes(
                  currentAttributes,
                  /** @type {ContentFormat} */
                  item.content
                );
              }
              break;
            }
          }
          item = item.right;
        }
        addOp();
        while (delta.length > 0) {
          const lastOp = delta[delta.length - 1];
          if (lastOp.retain !== void 0 && lastOp.attributes === void 0) {
            delta.pop();
          } else {
            break;
          }
        }
      });
      this._delta = delta;
    }
    return (
      /** @type {any} */
      this._delta
    );
  }
};
var YText = class _YText extends AbstractType {
  /**
   * @param {String} [string] The initial value of the YText.
   */
  constructor(string) {
    super();
    this._pending = string !== void 0 ? [() => this.insert(0, string)] : [];
    this._searchMarker = [];
    this._hasFormatting = false;
  }
  /**
   * Number of characters of this text type.
   *
   * @type {number}
   */
  get length() {
    this.doc ?? warnPrematureAccess();
    return this._length;
  }
  /**
   * @param {Doc} y
   * @param {Item} item
   */
  _integrate(y, item) {
    super._integrate(y, item);
    try {
      this._pending.forEach((f) => f());
    } catch (e) {
      console.error(e);
    }
    this._pending = null;
  }
  _copy() {
    return new _YText();
  }
  /**
   * Makes a copy of this data type that can be included somewhere else.
   *
   * Note that the content is only readable _after_ it has been included somewhere in the Ydoc.
   *
   * @return {YText}
   */
  clone() {
    const text2 = new _YText();
    text2.applyDelta(this.toDelta());
    return text2;
  }
  /**
   * Creates YTextEvent and calls observers.
   *
   * @param {Transaction} transaction
   * @param {Set<null|string>} parentSubs Keys changed on this type. `null` if list was modified.
   */
  _callObserver(transaction, parentSubs) {
    super._callObserver(transaction, parentSubs);
    const event = new YTextEvent(this, transaction, parentSubs);
    callTypeObservers(this, transaction, event);
    if (!transaction.local && this._hasFormatting) {
      transaction._needFormattingCleanup = true;
    }
  }
  /**
   * Returns the unformatted string representation of this YText type.
   *
   * @public
   */
  toString() {
    this.doc ?? warnPrematureAccess();
    let str = "";
    let n = this._start;
    while (n !== null) {
      if (!n.deleted && n.countable && n.content.constructor === ContentString) {
        str += /** @type {ContentString} */
        n.content.str;
      }
      n = n.right;
    }
    return str;
  }
  /**
   * Returns the unformatted string representation of this YText type.
   *
   * @return {string}
   * @public
   */
  toJSON() {
    return this.toString();
  }
  /**
   * Apply a {@link Delta} on this shared YText type.
   *
   * @param {Array<any>} delta The changes to apply on this element.
   * @param {object}  opts
   * @param {boolean} [opts.sanitize] Sanitize input delta. Removes ending newlines if set to true.
   *
   *
   * @public
   */
  applyDelta(delta, { sanitize = true } = {}) {
    if (this.doc !== null) {
      transact(this.doc, (transaction) => {
        const currPos = new ItemTextListPosition(null, this._start, 0, /* @__PURE__ */ new Map());
        for (let i = 0; i < delta.length; i++) {
          const op = delta[i];
          if (op.insert !== void 0) {
            const ins = !sanitize && typeof op.insert === "string" && i === delta.length - 1 && currPos.right === null && op.insert.slice(-1) === "\n" ? op.insert.slice(0, -1) : op.insert;
            if (typeof ins !== "string" || ins.length > 0) {
              insertText(transaction, this, currPos, ins, op.attributes || {});
            }
          } else if (op.retain !== void 0) {
            formatText(transaction, this, currPos, op.retain, op.attributes || {});
          } else if (op.delete !== void 0) {
            deleteText(transaction, currPos, op.delete);
          }
        }
      });
    } else {
      this._pending.push(() => this.applyDelta(delta));
    }
  }
  /**
   * Returns the Delta representation of this YText type.
   *
   * @param {Snapshot} [snapshot]
   * @param {Snapshot} [prevSnapshot]
   * @param {function('removed' | 'added', ID):any} [computeYChange]
   * @return {any} The Delta representation of this type.
   *
   * @public
   */
  toDelta(snapshot, prevSnapshot, computeYChange) {
    this.doc ?? warnPrematureAccess();
    const ops = [];
    const currentAttributes = /* @__PURE__ */ new Map();
    const doc2 = (
      /** @type {Doc} */
      this.doc
    );
    let str = "";
    let n = this._start;
    function packStr() {
      if (str.length > 0) {
        const attributes = {};
        let addAttributes = false;
        currentAttributes.forEach((value, key) => {
          addAttributes = true;
          attributes[key] = value;
        });
        const op = { insert: str };
        if (addAttributes) {
          op.attributes = attributes;
        }
        ops.push(op);
        str = "";
      }
    }
    const computeDelta = () => {
      while (n !== null) {
        if (isVisible(n, snapshot) || prevSnapshot !== void 0 && isVisible(n, prevSnapshot)) {
          switch (n.content.constructor) {
            case ContentString: {
              const cur = currentAttributes.get("ychange");
              if (snapshot !== void 0 && !isVisible(n, snapshot)) {
                if (cur === void 0 || cur.user !== n.id.client || cur.type !== "removed") {
                  packStr();
                  currentAttributes.set("ychange", computeYChange ? computeYChange("removed", n.id) : { type: "removed" });
                }
              } else if (prevSnapshot !== void 0 && !isVisible(n, prevSnapshot)) {
                if (cur === void 0 || cur.user !== n.id.client || cur.type !== "added") {
                  packStr();
                  currentAttributes.set("ychange", computeYChange ? computeYChange("added", n.id) : { type: "added" });
                }
              } else if (cur !== void 0) {
                packStr();
                currentAttributes.delete("ychange");
              }
              str += /** @type {ContentString} */
              n.content.str;
              break;
            }
            case ContentType:
            case ContentEmbed: {
              packStr();
              const op = {
                insert: n.content.getContent()[0]
              };
              if (currentAttributes.size > 0) {
                const attrs = (
                  /** @type {Object<string,any>} */
                  {}
                );
                op.attributes = attrs;
                currentAttributes.forEach((value, key) => {
                  attrs[key] = value;
                });
              }
              ops.push(op);
              break;
            }
            case ContentFormat:
              if (isVisible(n, snapshot)) {
                packStr();
                updateCurrentAttributes(
                  currentAttributes,
                  /** @type {ContentFormat} */
                  n.content
                );
              }
              break;
          }
        }
        n = n.right;
      }
      packStr();
    };
    if (snapshot || prevSnapshot) {
      transact(doc2, (transaction) => {
        if (snapshot) {
          splitSnapshotAffectedStructs(transaction, snapshot);
        }
        if (prevSnapshot) {
          splitSnapshotAffectedStructs(transaction, prevSnapshot);
        }
        computeDelta();
      }, "cleanup");
    } else {
      computeDelta();
    }
    return ops;
  }
  /**
   * Insert text at a given index.
   *
   * @param {number} index The index at which to start inserting.
   * @param {String} text The text to insert at the specified position.
   * @param {TextAttributes} [attributes] Optionally define some formatting
   *                                    information to apply on the inserted
   *                                    Text.
   * @public
   */
  insert(index, text2, attributes) {
    if (text2.length <= 0) {
      return;
    }
    const y = this.doc;
    if (y !== null) {
      transact(y, (transaction) => {
        const pos = findPosition(transaction, this, index, !attributes);
        if (!attributes) {
          attributes = {};
          pos.currentAttributes.forEach((v, k) => {
            attributes[k] = v;
          });
        }
        insertText(transaction, this, pos, text2, attributes);
      });
    } else {
      this._pending.push(() => this.insert(index, text2, attributes));
    }
  }
  /**
   * Inserts an embed at a index.
   *
   * @param {number} index The index to insert the embed at.
   * @param {Object | AbstractType<any>} embed The Object that represents the embed.
   * @param {TextAttributes} [attributes] Attribute information to apply on the
   *                                    embed
   *
   * @public
   */
  insertEmbed(index, embed, attributes) {
    const y = this.doc;
    if (y !== null) {
      transact(y, (transaction) => {
        const pos = findPosition(transaction, this, index, !attributes);
        insertText(transaction, this, pos, embed, attributes || {});
      });
    } else {
      this._pending.push(() => this.insertEmbed(index, embed, attributes || {}));
    }
  }
  /**
   * Deletes text starting from an index.
   *
   * @param {number} index Index at which to start deleting.
   * @param {number} length The number of characters to remove. Defaults to 1.
   *
   * @public
   */
  delete(index, length2) {
    if (length2 === 0) {
      return;
    }
    const y = this.doc;
    if (y !== null) {
      transact(y, (transaction) => {
        deleteText(transaction, findPosition(transaction, this, index, true), length2);
      });
    } else {
      this._pending.push(() => this.delete(index, length2));
    }
  }
  /**
   * Assigns properties to a range of text.
   *
   * @param {number} index The position where to start formatting.
   * @param {number} length The amount of characters to assign properties to.
   * @param {TextAttributes} attributes Attribute information to apply on the
   *                                    text.
   *
   * @public
   */
  format(index, length2, attributes) {
    if (length2 === 0) {
      return;
    }
    const y = this.doc;
    if (y !== null) {
      transact(y, (transaction) => {
        const pos = findPosition(transaction, this, index, false);
        if (pos.right === null) {
          return;
        }
        formatText(transaction, this, pos, length2, attributes);
      });
    } else {
      this._pending.push(() => this.format(index, length2, attributes));
    }
  }
  /**
   * Removes an attribute.
   *
   * @note Xml-Text nodes don't have attributes. You can use this feature to assign properties to complete text-blocks.
   *
   * @param {String} attributeName The attribute name that is to be removed.
   *
   * @public
   */
  removeAttribute(attributeName) {
    if (this.doc !== null) {
      transact(this.doc, (transaction) => {
        typeMapDelete(transaction, this, attributeName);
      });
    } else {
      this._pending.push(() => this.removeAttribute(attributeName));
    }
  }
  /**
   * Sets or updates an attribute.
   *
   * @note Xml-Text nodes don't have attributes. You can use this feature to assign properties to complete text-blocks.
   *
   * @param {String} attributeName The attribute name that is to be set.
   * @param {any} attributeValue The attribute value that is to be set.
   *
   * @public
   */
  setAttribute(attributeName, attributeValue) {
    if (this.doc !== null) {
      transact(this.doc, (transaction) => {
        typeMapSet(transaction, this, attributeName, attributeValue);
      });
    } else {
      this._pending.push(() => this.setAttribute(attributeName, attributeValue));
    }
  }
  /**
   * Returns an attribute value that belongs to the attribute name.
   *
   * @note Xml-Text nodes don't have attributes. You can use this feature to assign properties to complete text-blocks.
   *
   * @param {String} attributeName The attribute name that identifies the
   *                               queried value.
   * @return {any} The queried attribute value.
   *
   * @public
   */
  getAttribute(attributeName) {
    return (
      /** @type {any} */
      typeMapGet(this, attributeName)
    );
  }
  /**
   * Returns all attribute name/value pairs in a JSON Object.
   *
   * @note Xml-Text nodes don't have attributes. You can use this feature to assign properties to complete text-blocks.
   *
   * @return {Object<string, any>} A JSON Object that describes the attributes.
   *
   * @public
   */
  getAttributes() {
    return typeMapGetAll(this);
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   */
  _write(encoder2) {
    encoder2.writeTypeRef(YTextRefID);
  }
};
var readYText = (_decoder) => new YText();
var YXmlTreeWalker = class {
  /**
   * @param {YXmlFragment | YXmlElement} root
   * @param {function(AbstractType<any>):boolean} [f]
   */
  constructor(root, f = () => true) {
    this._filter = f;
    this._root = root;
    this._currentNode = /** @type {Item} */
    root._start;
    this._firstCall = true;
    root.doc ?? warnPrematureAccess();
  }
  [Symbol.iterator]() {
    return this;
  }
  /**
   * Get the next node.
   *
   * @return {IteratorResult<YXmlElement|YXmlText|YXmlHook>} The next node.
   *
   * @public
   */
  next() {
    let n = this._currentNode;
    let type = n && n.content && /** @type {any} */
    n.content.type;
    if (n !== null && (!this._firstCall || n.deleted || !this._filter(type))) {
      do {
        type = /** @type {any} */
        n.content.type;
        if (!n.deleted && (type.constructor === YXmlElement || type.constructor === YXmlFragment) && type._start !== null) {
          n = type._start;
        } else {
          while (n !== null) {
            const nxt = n.next;
            if (nxt !== null) {
              n = nxt;
              break;
            } else if (n.parent === this._root) {
              n = null;
            } else {
              n = /** @type {AbstractType<any>} */
              n.parent._item;
            }
          }
        }
      } while (n !== null && (n.deleted || !this._filter(
        /** @type {ContentType} */
        n.content.type
      )));
    }
    this._firstCall = false;
    if (n === null) {
      return { value: void 0, done: true };
    }
    this._currentNode = n;
    return { value: (
      /** @type {any} */
      n.content.type
    ), done: false };
  }
};
var YXmlFragment = class _YXmlFragment extends AbstractType {
  constructor() {
    super();
    this._prelimContent = [];
  }
  /**
   * @type {YXmlElement|YXmlText|null}
   */
  get firstChild() {
    const first = this._first;
    return first ? first.content.getContent()[0] : null;
  }
  /**
   * Integrate this type into the Yjs instance.
   *
   * * Save this struct in the os
   * * This type is sent to other client
   * * Observer functions are fired
   *
   * @param {Doc} y The Yjs instance
   * @param {Item} item
   */
  _integrate(y, item) {
    super._integrate(y, item);
    this.insert(
      0,
      /** @type {Array<any>} */
      this._prelimContent
    );
    this._prelimContent = null;
  }
  _copy() {
    return new _YXmlFragment();
  }
  /**
   * Makes a copy of this data type that can be included somewhere else.
   *
   * Note that the content is only readable _after_ it has been included somewhere in the Ydoc.
   *
   * @return {YXmlFragment}
   */
  clone() {
    const el = new _YXmlFragment();
    el.insert(0, this.toArray().map((item) => item instanceof AbstractType ? item.clone() : item));
    return el;
  }
  get length() {
    this.doc ?? warnPrematureAccess();
    return this._prelimContent === null ? this._length : this._prelimContent.length;
  }
  /**
   * Create a subtree of childNodes.
   *
   * @example
   * const walker = elem.createTreeWalker(dom => dom.nodeName === 'div')
   * for (let node in walker) {
   *   // `node` is a div node
   *   nop(node)
   * }
   *
   * @param {function(AbstractType<any>):boolean} filter Function that is called on each child element and
   *                          returns a Boolean indicating whether the child
   *                          is to be included in the subtree.
   * @return {YXmlTreeWalker} A subtree and a position within it.
   *
   * @public
   */
  createTreeWalker(filter) {
    return new YXmlTreeWalker(this, filter);
  }
  /**
   * Returns the first YXmlElement that matches the query.
   * Similar to DOM's {@link querySelector}.
   *
   * Query support:
   *   - tagname
   * TODO:
   *   - id
   *   - attribute
   *
   * @param {CSS_Selector} query The query on the children.
   * @return {YXmlElement|YXmlText|YXmlHook|null} The first element that matches the query or null.
   *
   * @public
   */
  querySelector(query) {
    query = query.toUpperCase();
    const iterator = new YXmlTreeWalker(this, (element2) => element2.nodeName && element2.nodeName.toUpperCase() === query);
    const next = iterator.next();
    if (next.done) {
      return null;
    } else {
      return next.value;
    }
  }
  /**
   * Returns all YXmlElements that match the query.
   * Similar to Dom's {@link querySelectorAll}.
   *
   * @todo Does not yet support all queries. Currently only query by tagName.
   *
   * @param {CSS_Selector} query The query on the children
   * @return {Array<YXmlElement|YXmlText|YXmlHook|null>} The elements that match this query.
   *
   * @public
   */
  querySelectorAll(query) {
    query = query.toUpperCase();
    return from(new YXmlTreeWalker(this, (element2) => element2.nodeName && element2.nodeName.toUpperCase() === query));
  }
  /**
   * Creates YXmlEvent and calls observers.
   *
   * @param {Transaction} transaction
   * @param {Set<null|string>} parentSubs Keys changed on this type. `null` if list was modified.
   */
  _callObserver(transaction, parentSubs) {
    callTypeObservers(this, transaction, new YXmlEvent(this, parentSubs, transaction));
  }
  /**
   * Get the string representation of all the children of this YXmlFragment.
   *
   * @return {string} The string representation of all children.
   */
  toString() {
    return typeListMap(this, (xml) => xml.toString()).join("");
  }
  /**
   * @return {string}
   */
  toJSON() {
    return this.toString();
  }
  /**
   * Creates a Dom Element that mirrors this YXmlElement.
   *
   * @param {Document} [_document=document] The document object (you must define
   *                                        this when calling this method in
   *                                        nodejs)
   * @param {Object<string, any>} [hooks={}] Optional property to customize how hooks
   *                                             are presented in the DOM
   * @param {any} [binding] You should not set this property. This is
   *                               used if DomBinding wants to create a
   *                               association to the created DOM type.
   * @return {Node} The {@link https://developer.mozilla.org/en-US/docs/Web/API/Element|Dom Element}
   *
   * @public
   */
  toDOM(_document = document, hooks = {}, binding) {
    const fragment = _document.createDocumentFragment();
    if (binding !== void 0) {
      binding._createAssociation(fragment, this);
    }
    typeListForEach(this, (xmlType) => {
      fragment.insertBefore(xmlType.toDOM(_document, hooks, binding), null);
    });
    return fragment;
  }
  /**
   * Inserts new content at an index.
   *
   * @example
   *  // Insert character 'a' at position 0
   *  xml.insert(0, [new Y.XmlText('text')])
   *
   * @param {number} index The index to insert content at
   * @param {Array<YXmlElement|YXmlText>} content The array of content
   */
  insert(index, content) {
    if (this.doc !== null) {
      transact(this.doc, (transaction) => {
        typeListInsertGenerics(transaction, this, index, content);
      });
    } else {
      this._prelimContent.splice(index, 0, ...content);
    }
  }
  /**
   * Inserts new content at an index.
   *
   * @example
   *  // Insert character 'a' at position 0
   *  xml.insert(0, [new Y.XmlText('text')])
   *
   * @param {null|Item|YXmlElement|YXmlText} ref The index to insert content at
   * @param {Array<YXmlElement|YXmlText>} content The array of content
   */
  insertAfter(ref, content) {
    if (this.doc !== null) {
      transact(this.doc, (transaction) => {
        const refItem = ref && ref instanceof AbstractType ? ref._item : ref;
        typeListInsertGenericsAfter(transaction, this, refItem, content);
      });
    } else {
      const pc = (
        /** @type {Array<any>} */
        this._prelimContent
      );
      const index = ref === null ? 0 : pc.findIndex((el) => el === ref) + 1;
      if (index === 0 && ref !== null) {
        throw create3("Reference item not found");
      }
      pc.splice(index, 0, ...content);
    }
  }
  /**
   * Deletes elements starting from an index.
   *
   * @param {number} index Index at which to start deleting elements
   * @param {number} [length=1] The number of elements to remove. Defaults to 1.
   */
  delete(index, length2 = 1) {
    if (this.doc !== null) {
      transact(this.doc, (transaction) => {
        typeListDelete(transaction, this, index, length2);
      });
    } else {
      this._prelimContent.splice(index, length2);
    }
  }
  /**
   * Transforms this YArray to a JavaScript Array.
   *
   * @return {Array<YXmlElement|YXmlText|YXmlHook>}
   */
  toArray() {
    return typeListToArray(this);
  }
  /**
   * Appends content to this YArray.
   *
   * @param {Array<YXmlElement|YXmlText>} content Array of content to append.
   */
  push(content) {
    this.insert(this.length, content);
  }
  /**
   * Prepends content to this YArray.
   *
   * @param {Array<YXmlElement|YXmlText>} content Array of content to prepend.
   */
  unshift(content) {
    this.insert(0, content);
  }
  /**
   * Returns the i-th element from a YArray.
   *
   * @param {number} index The index of the element to return from the YArray
   * @return {YXmlElement|YXmlText}
   */
  get(index) {
    return typeListGet(this, index);
  }
  /**
   * Returns a portion of this YXmlFragment into a JavaScript Array selected
   * from start to end (end not included).
   *
   * @param {number} [start]
   * @param {number} [end]
   * @return {Array<YXmlElement|YXmlText>}
   */
  slice(start = 0, end = this.length) {
    return typeListSlice(this, start, end);
  }
  /**
   * Executes a provided function on once on every child element.
   *
   * @param {function(YXmlElement|YXmlText,number, typeof self):void} f A function to execute on every element of this YArray.
   */
  forEach(f) {
    typeListForEach(this, f);
  }
  /**
   * Transform the properties of this type to binary and write it to an
   * BinaryEncoder.
   *
   * This is called when this Item is sent to a remote peer.
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder The encoder to write data to.
   */
  _write(encoder2) {
    encoder2.writeTypeRef(YXmlFragmentRefID);
  }
};
var readYXmlFragment = (_decoder) => new YXmlFragment();
var YXmlElement = class _YXmlElement extends YXmlFragment {
  constructor(nodeName = "UNDEFINED") {
    super();
    this.nodeName = nodeName;
    this._prelimAttrs = /* @__PURE__ */ new Map();
  }
  /**
   * @type {YXmlElement|YXmlText|null}
   */
  get nextSibling() {
    const n = this._item ? this._item.next : null;
    return n ? (
      /** @type {YXmlElement|YXmlText} */
      /** @type {ContentType} */
      n.content.type
    ) : null;
  }
  /**
   * @type {YXmlElement|YXmlText|null}
   */
  get prevSibling() {
    const n = this._item ? this._item.prev : null;
    return n ? (
      /** @type {YXmlElement|YXmlText} */
      /** @type {ContentType} */
      n.content.type
    ) : null;
  }
  /**
   * Integrate this type into the Yjs instance.
   *
   * * Save this struct in the os
   * * This type is sent to other client
   * * Observer functions are fired
   *
   * @param {Doc} y The Yjs instance
   * @param {Item} item
   */
  _integrate(y, item) {
    super._integrate(y, item);
    /** @type {Map<string, any>} */
    this._prelimAttrs.forEach((value, key) => {
      this.setAttribute(key, value);
    });
    this._prelimAttrs = null;
  }
  /**
   * Creates an Item with the same effect as this Item (without position effect)
   *
   * @return {YXmlElement}
   */
  _copy() {
    return new _YXmlElement(this.nodeName);
  }
  /**
   * Makes a copy of this data type that can be included somewhere else.
   *
   * Note that the content is only readable _after_ it has been included somewhere in the Ydoc.
   *
   * @return {YXmlElement<KV>}
   */
  clone() {
    const el = new _YXmlElement(this.nodeName);
    const attrs = this.getAttributes();
    forEach(attrs, (value, key) => {
      el.setAttribute(
        key,
        /** @type {any} */
        value
      );
    });
    el.insert(0, this.toArray().map((v) => v instanceof AbstractType ? v.clone() : v));
    return el;
  }
  /**
   * Returns the XML serialization of this YXmlElement.
   * The attributes are ordered by attribute-name, so you can easily use this
   * method to compare YXmlElements
   *
   * @return {string} The string representation of this type.
   *
   * @public
   */
  toString() {
    const attrs = this.getAttributes();
    const stringBuilder = [];
    const keys2 = [];
    for (const key in attrs) {
      keys2.push(key);
    }
    keys2.sort();
    const keysLen = keys2.length;
    for (let i = 0; i < keysLen; i++) {
      const key = keys2[i];
      stringBuilder.push(key + '="' + attrs[key] + '"');
    }
    const nodeName = this.nodeName.toLocaleLowerCase();
    const attrsString = stringBuilder.length > 0 ? " " + stringBuilder.join(" ") : "";
    return `<${nodeName}${attrsString}>${super.toString()}</${nodeName}>`;
  }
  /**
   * Removes an attribute from this YXmlElement.
   *
   * @param {string} attributeName The attribute name that is to be removed.
   *
   * @public
   */
  removeAttribute(attributeName) {
    if (this.doc !== null) {
      transact(this.doc, (transaction) => {
        typeMapDelete(transaction, this, attributeName);
      });
    } else {
      this._prelimAttrs.delete(attributeName);
    }
  }
  /**
   * Sets or updates an attribute.
   *
   * @template {keyof KV & string} KEY
   *
   * @param {KEY} attributeName The attribute name that is to be set.
   * @param {KV[KEY]} attributeValue The attribute value that is to be set.
   *
   * @public
   */
  setAttribute(attributeName, attributeValue) {
    if (this.doc !== null) {
      transact(this.doc, (transaction) => {
        typeMapSet(transaction, this, attributeName, attributeValue);
      });
    } else {
      this._prelimAttrs.set(attributeName, attributeValue);
    }
  }
  /**
   * Returns an attribute value that belongs to the attribute name.
   *
   * @template {keyof KV & string} KEY
   *
   * @param {KEY} attributeName The attribute name that identifies the
   *                               queried value.
   * @return {KV[KEY]|undefined} The queried attribute value.
   *
   * @public
   */
  getAttribute(attributeName) {
    return (
      /** @type {any} */
      typeMapGet(this, attributeName)
    );
  }
  /**
   * Returns whether an attribute exists
   *
   * @param {string} attributeName The attribute name to check for existence.
   * @return {boolean} whether the attribute exists.
   *
   * @public
   */
  hasAttribute(attributeName) {
    return (
      /** @type {any} */
      typeMapHas(this, attributeName)
    );
  }
  /**
   * Returns all attribute name/value pairs in a JSON Object.
   *
   * @param {Snapshot} [snapshot]
   * @return {{ [Key in Extract<keyof KV,string>]?: KV[Key]}} A JSON Object that describes the attributes.
   *
   * @public
   */
  getAttributes(snapshot) {
    return (
      /** @type {any} */
      snapshot ? typeMapGetAllSnapshot(this, snapshot) : typeMapGetAll(this)
    );
  }
  /**
   * Creates a Dom Element that mirrors this YXmlElement.
   *
   * @param {Document} [_document=document] The document object (you must define
   *                                        this when calling this method in
   *                                        nodejs)
   * @param {Object<string, any>} [hooks={}] Optional property to customize how hooks
   *                                             are presented in the DOM
   * @param {any} [binding] You should not set this property. This is
   *                               used if DomBinding wants to create a
   *                               association to the created DOM type.
   * @return {Node} The {@link https://developer.mozilla.org/en-US/docs/Web/API/Element|Dom Element}
   *
   * @public
   */
  toDOM(_document = document, hooks = {}, binding) {
    const dom = _document.createElement(this.nodeName);
    const attrs = this.getAttributes();
    for (const key in attrs) {
      const value = attrs[key];
      if (typeof value === "string") {
        dom.setAttribute(key, value);
      }
    }
    typeListForEach(this, (yxml) => {
      dom.appendChild(yxml.toDOM(_document, hooks, binding));
    });
    if (binding !== void 0) {
      binding._createAssociation(dom, this);
    }
    return dom;
  }
  /**
   * Transform the properties of this type to binary and write it to an
   * BinaryEncoder.
   *
   * This is called when this Item is sent to a remote peer.
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder The encoder to write data to.
   */
  _write(encoder2) {
    encoder2.writeTypeRef(YXmlElementRefID);
    encoder2.writeKey(this.nodeName);
  }
};
var readYXmlElement = (decoder) => new YXmlElement(decoder.readKey());
var YXmlEvent = class extends YEvent {
  /**
   * @param {YXmlElement|YXmlText|YXmlFragment} target The target on which the event is created.
   * @param {Set<string|null>} subs The set of changed attributes. `null` is included if the
   *                   child list changed.
   * @param {Transaction} transaction The transaction instance with which the
   *                                  change was created.
   */
  constructor(target, subs, transaction) {
    super(target, transaction);
    this.childListChanged = false;
    this.attributesChanged = /* @__PURE__ */ new Set();
    subs.forEach((sub) => {
      if (sub === null) {
        this.childListChanged = true;
      } else {
        this.attributesChanged.add(sub);
      }
    });
  }
};
var YXmlHook = class _YXmlHook extends YMap {
  /**
   * @param {string} hookName nodeName of the Dom Node.
   */
  constructor(hookName) {
    super();
    this.hookName = hookName;
  }
  /**
   * Creates an Item with the same effect as this Item (without position effect)
   */
  _copy() {
    return new _YXmlHook(this.hookName);
  }
  /**
   * Makes a copy of this data type that can be included somewhere else.
   *
   * Note that the content is only readable _after_ it has been included somewhere in the Ydoc.
   *
   * @return {YXmlHook}
   */
  clone() {
    const el = new _YXmlHook(this.hookName);
    this.forEach((value, key) => {
      el.set(key, value);
    });
    return el;
  }
  /**
   * Creates a Dom Element that mirrors this YXmlElement.
   *
   * @param {Document} [_document=document] The document object (you must define
   *                                        this when calling this method in
   *                                        nodejs)
   * @param {Object.<string, any>} [hooks] Optional property to customize how hooks
   *                                             are presented in the DOM
   * @param {any} [binding] You should not set this property. This is
   *                               used if DomBinding wants to create a
   *                               association to the created DOM type
   * @return {Element} The {@link https://developer.mozilla.org/en-US/docs/Web/API/Element|Dom Element}
   *
   * @public
   */
  toDOM(_document = document, hooks = {}, binding) {
    const hook = hooks[this.hookName];
    let dom;
    if (hook !== void 0) {
      dom = hook.createDom(this);
    } else {
      dom = document.createElement(this.hookName);
    }
    dom.setAttribute("data-yjs-hook", this.hookName);
    if (binding !== void 0) {
      binding._createAssociation(dom, this);
    }
    return dom;
  }
  /**
   * Transform the properties of this type to binary and write it to an
   * BinaryEncoder.
   *
   * This is called when this Item is sent to a remote peer.
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder The encoder to write data to.
   */
  _write(encoder2) {
    encoder2.writeTypeRef(YXmlHookRefID);
    encoder2.writeKey(this.hookName);
  }
};
var readYXmlHook = (decoder) => new YXmlHook(decoder.readKey());
var YXmlText = class _YXmlText extends YText {
  /**
   * @type {YXmlElement|YXmlText|null}
   */
  get nextSibling() {
    const n = this._item ? this._item.next : null;
    return n ? (
      /** @type {YXmlElement|YXmlText} */
      /** @type {ContentType} */
      n.content.type
    ) : null;
  }
  /**
   * @type {YXmlElement|YXmlText|null}
   */
  get prevSibling() {
    const n = this._item ? this._item.prev : null;
    return n ? (
      /** @type {YXmlElement|YXmlText} */
      /** @type {ContentType} */
      n.content.type
    ) : null;
  }
  _copy() {
    return new _YXmlText();
  }
  /**
   * Makes a copy of this data type that can be included somewhere else.
   *
   * Note that the content is only readable _after_ it has been included somewhere in the Ydoc.
   *
   * @return {YXmlText}
   */
  clone() {
    const text2 = new _YXmlText();
    text2.applyDelta(this.toDelta());
    return text2;
  }
  /**
   * Creates a Dom Element that mirrors this YXmlText.
   *
   * @param {Document} [_document=document] The document object (you must define
   *                                        this when calling this method in
   *                                        nodejs)
   * @param {Object<string, any>} [hooks] Optional property to customize how hooks
   *                                             are presented in the DOM
   * @param {any} [binding] You should not set this property. This is
   *                               used if DomBinding wants to create a
   *                               association to the created DOM type.
   * @return {Text} The {@link https://developer.mozilla.org/en-US/docs/Web/API/Element|Dom Element}
   *
   * @public
   */
  toDOM(_document = document, hooks, binding) {
    const dom = _document.createTextNode(this.toString());
    if (binding !== void 0) {
      binding._createAssociation(dom, this);
    }
    return dom;
  }
  toString() {
    return this.toDelta().map((delta) => {
      const nestedNodes = [];
      for (const nodeName in delta.attributes) {
        const attrs = [];
        for (const key in delta.attributes[nodeName]) {
          attrs.push({ key, value: delta.attributes[nodeName][key] });
        }
        attrs.sort((a, b) => a.key < b.key ? -1 : 1);
        nestedNodes.push({ nodeName, attrs });
      }
      nestedNodes.sort((a, b) => a.nodeName < b.nodeName ? -1 : 1);
      let str = "";
      for (let i = 0; i < nestedNodes.length; i++) {
        const node = nestedNodes[i];
        str += `<${node.nodeName}`;
        for (let j = 0; j < node.attrs.length; j++) {
          const attr = node.attrs[j];
          str += ` ${attr.key}="${attr.value}"`;
        }
        str += ">";
      }
      str += delta.insert;
      for (let i = nestedNodes.length - 1; i >= 0; i--) {
        str += `</${nestedNodes[i].nodeName}>`;
      }
      return str;
    }).join("");
  }
  /**
   * @return {string}
   */
  toJSON() {
    return this.toString();
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   */
  _write(encoder2) {
    encoder2.writeTypeRef(YXmlTextRefID);
  }
};
var readYXmlText = (decoder) => new YXmlText();
var AbstractStruct = class {
  /**
   * @param {ID} id
   * @param {number} length
   */
  constructor(id2, length2) {
    this.id = id2;
    this.length = length2;
  }
  /**
   * @type {boolean}
   */
  get deleted() {
    throw methodUnimplemented();
  }
  /**
   * Merge this struct with the item to the right.
   * This method is already assuming that `this.id.clock + this.length === this.id.clock`.
   * Also this method does *not* remove right from StructStore!
   * @param {AbstractStruct} right
   * @return {boolean} whether this merged with right
   */
  mergeWith(right) {
    return false;
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder The encoder to write data to.
   * @param {number} offset
   * @param {number} encodingRef
   */
  write(encoder2, offset, encodingRef) {
    throw methodUnimplemented();
  }
  /**
   * @param {Transaction} transaction
   * @param {number} offset
   */
  integrate(transaction, offset) {
    throw methodUnimplemented();
  }
};
var structGCRefNumber = 0;
var GC = class extends AbstractStruct {
  get deleted() {
    return true;
  }
  delete() {
  }
  /**
   * @param {GC} right
   * @return {boolean}
   */
  mergeWith(right) {
    if (this.constructor !== right.constructor) {
      return false;
    }
    this.length += right.length;
    return true;
  }
  /**
   * @param {Transaction} transaction
   * @param {number} offset
   */
  integrate(transaction, offset) {
    if (offset > 0) {
      this.id.clock += offset;
      this.length -= offset;
    }
    addStruct(transaction.doc.store, this);
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder2, offset) {
    encoder2.writeInfo(structGCRefNumber);
    encoder2.writeLen(this.length - offset);
  }
  /**
   * @param {Transaction} transaction
   * @param {StructStore} store
   * @return {null | number}
   */
  getMissing(transaction, store) {
    return null;
  }
};
var ContentBinary = class _ContentBinary {
  /**
   * @param {Uint8Array} content
   */
  constructor(content) {
    this.content = content;
  }
  /**
   * @return {number}
   */
  getLength() {
    return 1;
  }
  /**
   * @return {Array<any>}
   */
  getContent() {
    return [this.content];
  }
  /**
   * @return {boolean}
   */
  isCountable() {
    return true;
  }
  /**
   * @return {ContentBinary}
   */
  copy() {
    return new _ContentBinary(this.content);
  }
  /**
   * @param {number} offset
   * @return {ContentBinary}
   */
  splice(offset) {
    throw methodUnimplemented();
  }
  /**
   * @param {ContentBinary} right
   * @return {boolean}
   */
  mergeWith(right) {
    return false;
  }
  /**
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate(transaction, item) {
  }
  /**
   * @param {Transaction} transaction
   */
  delete(transaction) {
  }
  /**
   * @param {StructStore} store
   */
  gc(store) {
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder2, offset) {
    encoder2.writeBuf(this.content);
  }
  /**
   * @return {number}
   */
  getRef() {
    return 3;
  }
};
var readContentBinary = (decoder) => new ContentBinary(decoder.readBuf());
var ContentDeleted = class _ContentDeleted {
  /**
   * @param {number} len
   */
  constructor(len) {
    this.len = len;
  }
  /**
   * @return {number}
   */
  getLength() {
    return this.len;
  }
  /**
   * @return {Array<any>}
   */
  getContent() {
    return [];
  }
  /**
   * @return {boolean}
   */
  isCountable() {
    return false;
  }
  /**
   * @return {ContentDeleted}
   */
  copy() {
    return new _ContentDeleted(this.len);
  }
  /**
   * @param {number} offset
   * @return {ContentDeleted}
   */
  splice(offset) {
    const right = new _ContentDeleted(this.len - offset);
    this.len = offset;
    return right;
  }
  /**
   * @param {ContentDeleted} right
   * @return {boolean}
   */
  mergeWith(right) {
    this.len += right.len;
    return true;
  }
  /**
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate(transaction, item) {
    addToDeleteSet(transaction.deleteSet, item.id.client, item.id.clock, this.len);
    item.markDeleted();
  }
  /**
   * @param {Transaction} transaction
   */
  delete(transaction) {
  }
  /**
   * @param {StructStore} store
   */
  gc(store) {
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder2, offset) {
    encoder2.writeLen(this.len - offset);
  }
  /**
   * @return {number}
   */
  getRef() {
    return 1;
  }
};
var readContentDeleted = (decoder) => new ContentDeleted(decoder.readLen());
var createDocFromOpts = (guid, opts) => new Doc({ guid, ...opts, shouldLoad: opts.shouldLoad || opts.autoLoad || false });
var ContentDoc = class _ContentDoc {
  /**
   * @param {Doc} doc
   */
  constructor(doc2) {
    if (doc2._item) {
      console.error("This document was already integrated as a sub-document. You should create a second instance instead with the same guid.");
    }
    this.doc = doc2;
    const opts = {};
    this.opts = opts;
    if (!doc2.gc) {
      opts.gc = false;
    }
    if (doc2.autoLoad) {
      opts.autoLoad = true;
    }
    if (doc2.meta !== null) {
      opts.meta = doc2.meta;
    }
  }
  /**
   * @return {number}
   */
  getLength() {
    return 1;
  }
  /**
   * @return {Array<any>}
   */
  getContent() {
    return [this.doc];
  }
  /**
   * @return {boolean}
   */
  isCountable() {
    return true;
  }
  /**
   * @return {ContentDoc}
   */
  copy() {
    return new _ContentDoc(createDocFromOpts(this.doc.guid, this.opts));
  }
  /**
   * @param {number} offset
   * @return {ContentDoc}
   */
  splice(offset) {
    throw methodUnimplemented();
  }
  /**
   * @param {ContentDoc} right
   * @return {boolean}
   */
  mergeWith(right) {
    return false;
  }
  /**
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate(transaction, item) {
    this.doc._item = item;
    transaction.subdocsAdded.add(this.doc);
    if (this.doc.shouldLoad) {
      transaction.subdocsLoaded.add(this.doc);
    }
  }
  /**
   * @param {Transaction} transaction
   */
  delete(transaction) {
    if (transaction.subdocsAdded.has(this.doc)) {
      transaction.subdocsAdded.delete(this.doc);
    } else {
      transaction.subdocsRemoved.add(this.doc);
    }
  }
  /**
   * @param {StructStore} store
   */
  gc(store) {
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder2, offset) {
    encoder2.writeString(this.doc.guid);
    encoder2.writeAny(this.opts);
  }
  /**
   * @return {number}
   */
  getRef() {
    return 9;
  }
};
var readContentDoc = (decoder) => new ContentDoc(createDocFromOpts(decoder.readString(), decoder.readAny()));
var ContentEmbed = class _ContentEmbed {
  /**
   * @param {Object} embed
   */
  constructor(embed) {
    this.embed = embed;
  }
  /**
   * @return {number}
   */
  getLength() {
    return 1;
  }
  /**
   * @return {Array<any>}
   */
  getContent() {
    return [this.embed];
  }
  /**
   * @return {boolean}
   */
  isCountable() {
    return true;
  }
  /**
   * @return {ContentEmbed}
   */
  copy() {
    return new _ContentEmbed(this.embed);
  }
  /**
   * @param {number} offset
   * @return {ContentEmbed}
   */
  splice(offset) {
    throw methodUnimplemented();
  }
  /**
   * @param {ContentEmbed} right
   * @return {boolean}
   */
  mergeWith(right) {
    return false;
  }
  /**
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate(transaction, item) {
  }
  /**
   * @param {Transaction} transaction
   */
  delete(transaction) {
  }
  /**
   * @param {StructStore} store
   */
  gc(store) {
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder2, offset) {
    encoder2.writeJSON(this.embed);
  }
  /**
   * @return {number}
   */
  getRef() {
    return 5;
  }
};
var readContentEmbed = (decoder) => new ContentEmbed(decoder.readJSON());
var ContentFormat = class _ContentFormat {
  /**
   * @param {string} key
   * @param {Object} value
   */
  constructor(key, value) {
    this.key = key;
    this.value = value;
  }
  /**
   * @return {number}
   */
  getLength() {
    return 1;
  }
  /**
   * @return {Array<any>}
   */
  getContent() {
    return [];
  }
  /**
   * @return {boolean}
   */
  isCountable() {
    return false;
  }
  /**
   * @return {ContentFormat}
   */
  copy() {
    return new _ContentFormat(this.key, this.value);
  }
  /**
   * @param {number} _offset
   * @return {ContentFormat}
   */
  splice(_offset) {
    throw methodUnimplemented();
  }
  /**
   * @param {ContentFormat} _right
   * @return {boolean}
   */
  mergeWith(_right) {
    return false;
  }
  /**
   * @param {Transaction} _transaction
   * @param {Item} item
   */
  integrate(_transaction, item) {
    const p = (
      /** @type {YText} */
      item.parent
    );
    p._searchMarker = null;
    p._hasFormatting = true;
  }
  /**
   * @param {Transaction} transaction
   */
  delete(transaction) {
  }
  /**
   * @param {StructStore} store
   */
  gc(store) {
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder2, offset) {
    encoder2.writeKey(this.key);
    encoder2.writeJSON(this.value);
  }
  /**
   * @return {number}
   */
  getRef() {
    return 6;
  }
};
var readContentFormat = (decoder) => new ContentFormat(decoder.readKey(), decoder.readJSON());
var ContentJSON = class _ContentJSON {
  /**
   * @param {Array<any>} arr
   */
  constructor(arr) {
    this.arr = arr;
  }
  /**
   * @return {number}
   */
  getLength() {
    return this.arr.length;
  }
  /**
   * @return {Array<any>}
   */
  getContent() {
    return this.arr;
  }
  /**
   * @return {boolean}
   */
  isCountable() {
    return true;
  }
  /**
   * @return {ContentJSON}
   */
  copy() {
    return new _ContentJSON(this.arr);
  }
  /**
   * @param {number} offset
   * @return {ContentJSON}
   */
  splice(offset) {
    const right = new _ContentJSON(this.arr.slice(offset));
    this.arr = this.arr.slice(0, offset);
    return right;
  }
  /**
   * @param {ContentJSON} right
   * @return {boolean}
   */
  mergeWith(right) {
    this.arr = this.arr.concat(right.arr);
    return true;
  }
  /**
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate(transaction, item) {
  }
  /**
   * @param {Transaction} transaction
   */
  delete(transaction) {
  }
  /**
   * @param {StructStore} store
   */
  gc(store) {
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder2, offset) {
    const len = this.arr.length;
    encoder2.writeLen(len - offset);
    for (let i = offset; i < len; i++) {
      const c = this.arr[i];
      encoder2.writeString(c === void 0 ? "undefined" : JSON.stringify(c));
    }
  }
  /**
   * @return {number}
   */
  getRef() {
    return 2;
  }
};
var readContentJSON = (decoder) => {
  const len = decoder.readLen();
  const cs = [];
  for (let i = 0; i < len; i++) {
    const c = decoder.readString();
    if (c === "undefined") {
      cs.push(void 0);
    } else {
      cs.push(JSON.parse(c));
    }
  }
  return new ContentJSON(cs);
};
var isDevMode = getVariable("node_env") === "development";
var ContentAny = class _ContentAny {
  /**
   * @param {Array<any>} arr
   */
  constructor(arr) {
    this.arr = arr;
    isDevMode && deepFreeze(arr);
  }
  /**
   * @return {number}
   */
  getLength() {
    return this.arr.length;
  }
  /**
   * @return {Array<any>}
   */
  getContent() {
    return this.arr;
  }
  /**
   * @return {boolean}
   */
  isCountable() {
    return true;
  }
  /**
   * @return {ContentAny}
   */
  copy() {
    return new _ContentAny(this.arr);
  }
  /**
   * @param {number} offset
   * @return {ContentAny}
   */
  splice(offset) {
    const right = new _ContentAny(this.arr.slice(offset));
    this.arr = this.arr.slice(0, offset);
    return right;
  }
  /**
   * @param {ContentAny} right
   * @return {boolean}
   */
  mergeWith(right) {
    this.arr = this.arr.concat(right.arr);
    return true;
  }
  /**
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate(transaction, item) {
  }
  /**
   * @param {Transaction} transaction
   */
  delete(transaction) {
  }
  /**
   * @param {StructStore} store
   */
  gc(store) {
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder2, offset) {
    const len = this.arr.length;
    encoder2.writeLen(len - offset);
    for (let i = offset; i < len; i++) {
      const c = this.arr[i];
      encoder2.writeAny(c);
    }
  }
  /**
   * @return {number}
   */
  getRef() {
    return 8;
  }
};
var readContentAny = (decoder) => {
  const len = decoder.readLen();
  const cs = [];
  for (let i = 0; i < len; i++) {
    cs.push(decoder.readAny());
  }
  return new ContentAny(cs);
};
var ContentString = class _ContentString {
  /**
   * @param {string} str
   */
  constructor(str) {
    this.str = str;
  }
  /**
   * @return {number}
   */
  getLength() {
    return this.str.length;
  }
  /**
   * @return {Array<any>}
   */
  getContent() {
    return this.str.split("");
  }
  /**
   * @return {boolean}
   */
  isCountable() {
    return true;
  }
  /**
   * @return {ContentString}
   */
  copy() {
    return new _ContentString(this.str);
  }
  /**
   * @param {number} offset
   * @return {ContentString}
   */
  splice(offset) {
    const right = new _ContentString(this.str.slice(offset));
    this.str = this.str.slice(0, offset);
    const firstCharCode = this.str.charCodeAt(offset - 1);
    if (firstCharCode >= 55296 && firstCharCode <= 56319) {
      this.str = this.str.slice(0, offset - 1) + "\uFFFD";
      right.str = "\uFFFD" + right.str.slice(1);
    }
    return right;
  }
  /**
   * @param {ContentString} right
   * @return {boolean}
   */
  mergeWith(right) {
    this.str += right.str;
    return true;
  }
  /**
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate(transaction, item) {
  }
  /**
   * @param {Transaction} transaction
   */
  delete(transaction) {
  }
  /**
   * @param {StructStore} store
   */
  gc(store) {
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder2, offset) {
    encoder2.writeString(offset === 0 ? this.str : this.str.slice(offset));
  }
  /**
   * @return {number}
   */
  getRef() {
    return 4;
  }
};
var readContentString = (decoder) => new ContentString(decoder.readString());
var typeRefs = [
  readYArray,
  readYMap,
  readYText,
  readYXmlElement,
  readYXmlFragment,
  readYXmlHook,
  readYXmlText
];
var YArrayRefID = 0;
var YMapRefID = 1;
var YTextRefID = 2;
var YXmlElementRefID = 3;
var YXmlFragmentRefID = 4;
var YXmlHookRefID = 5;
var YXmlTextRefID = 6;
var ContentType = class _ContentType {
  /**
   * @param {AbstractType<any>} type
   */
  constructor(type) {
    this.type = type;
  }
  /**
   * @return {number}
   */
  getLength() {
    return 1;
  }
  /**
   * @return {Array<any>}
   */
  getContent() {
    return [this.type];
  }
  /**
   * @return {boolean}
   */
  isCountable() {
    return true;
  }
  /**
   * @return {ContentType}
   */
  copy() {
    return new _ContentType(this.type._copy());
  }
  /**
   * @param {number} offset
   * @return {ContentType}
   */
  splice(offset) {
    throw methodUnimplemented();
  }
  /**
   * @param {ContentType} right
   * @return {boolean}
   */
  mergeWith(right) {
    return false;
  }
  /**
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate(transaction, item) {
    this.type._integrate(transaction.doc, item);
  }
  /**
   * @param {Transaction} transaction
   */
  delete(transaction) {
    let item = this.type._start;
    while (item !== null) {
      if (!item.deleted) {
        item.delete(transaction);
      } else if (item.id.clock < (transaction.beforeState.get(item.id.client) || 0)) {
        transaction._mergeStructs.push(item);
      }
      item = item.right;
    }
    this.type._map.forEach((item2) => {
      if (!item2.deleted) {
        item2.delete(transaction);
      } else if (item2.id.clock < (transaction.beforeState.get(item2.id.client) || 0)) {
        transaction._mergeStructs.push(item2);
      }
    });
    transaction.changed.delete(this.type);
  }
  /**
   * @param {StructStore} store
   */
  gc(store) {
    let item = this.type._start;
    while (item !== null) {
      item.gc(store, true);
      item = item.right;
    }
    this.type._start = null;
    this.type._map.forEach(
      /** @param {Item | null} item */
      (item2) => {
        while (item2 !== null) {
          item2.gc(store, true);
          item2 = item2.left;
        }
      }
    );
    this.type._map = /* @__PURE__ */ new Map();
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder2, offset) {
    this.type._write(encoder2);
  }
  /**
   * @return {number}
   */
  getRef() {
    return 7;
  }
};
var readContentType = (decoder) => new ContentType(typeRefs[decoder.readTypeRef()](decoder));
var splitItem = (transaction, leftItem, diff) => {
  const { client, clock } = leftItem.id;
  const rightItem = new Item(
    createID(client, clock + diff),
    leftItem,
    createID(client, clock + diff - 1),
    leftItem.right,
    leftItem.rightOrigin,
    leftItem.parent,
    leftItem.parentSub,
    leftItem.content.splice(diff)
  );
  if (leftItem.deleted) {
    rightItem.markDeleted();
  }
  if (leftItem.keep) {
    rightItem.keep = true;
  }
  if (leftItem.redone !== null) {
    rightItem.redone = createID(leftItem.redone.client, leftItem.redone.clock + diff);
  }
  leftItem.right = rightItem;
  if (rightItem.right !== null) {
    rightItem.right.left = rightItem;
  }
  transaction._mergeStructs.push(rightItem);
  if (rightItem.parentSub !== null && rightItem.right === null) {
    rightItem.parent._map.set(rightItem.parentSub, rightItem);
  }
  leftItem.length = diff;
  return rightItem;
};
var Item = class _Item extends AbstractStruct {
  /**
   * @param {ID} id
   * @param {Item | null} left
   * @param {ID | null} origin
   * @param {Item | null} right
   * @param {ID | null} rightOrigin
   * @param {AbstractType<any>|ID|null} parent Is a type if integrated, is null if it is possible to copy parent from left or right, is ID before integration to search for it.
   * @param {string | null} parentSub
   * @param {AbstractContent} content
   */
  constructor(id2, left, origin, right, rightOrigin, parent, parentSub, content) {
    super(id2, content.getLength());
    this.origin = origin;
    this.left = left;
    this.right = right;
    this.rightOrigin = rightOrigin;
    this.parent = parent;
    this.parentSub = parentSub;
    this.redone = null;
    this.content = content;
    this.info = this.content.isCountable() ? BIT2 : 0;
  }
  /**
   * This is used to mark the item as an indexed fast-search marker
   *
   * @type {boolean}
   */
  set marker(isMarked) {
    if ((this.info & BIT4) > 0 !== isMarked) {
      this.info ^= BIT4;
    }
  }
  get marker() {
    return (this.info & BIT4) > 0;
  }
  /**
   * If true, do not garbage collect this Item.
   */
  get keep() {
    return (this.info & BIT1) > 0;
  }
  set keep(doKeep) {
    if (this.keep !== doKeep) {
      this.info ^= BIT1;
    }
  }
  get countable() {
    return (this.info & BIT2) > 0;
  }
  /**
   * Whether this item was deleted or not.
   * @type {Boolean}
   */
  get deleted() {
    return (this.info & BIT3) > 0;
  }
  set deleted(doDelete) {
    if (this.deleted !== doDelete) {
      this.info ^= BIT3;
    }
  }
  markDeleted() {
    this.info |= BIT3;
  }
  /**
   * Return the creator clientID of the missing op or define missing items and return null.
   *
   * @param {Transaction} transaction
   * @param {StructStore} store
   * @return {null | number}
   */
  getMissing(transaction, store) {
    if (this.origin && this.origin.client !== this.id.client && this.origin.clock >= getState(store, this.origin.client)) {
      return this.origin.client;
    }
    if (this.rightOrigin && this.rightOrigin.client !== this.id.client && this.rightOrigin.clock >= getState(store, this.rightOrigin.client)) {
      return this.rightOrigin.client;
    }
    if (this.parent && this.parent.constructor === ID && this.id.client !== this.parent.client && this.parent.clock >= getState(store, this.parent.client)) {
      return this.parent.client;
    }
    if (this.origin) {
      this.left = getItemCleanEnd(transaction, store, this.origin);
      this.origin = this.left.lastId;
    }
    if (this.rightOrigin) {
      this.right = getItemCleanStart(transaction, this.rightOrigin);
      this.rightOrigin = this.right.id;
    }
    if (this.left && this.left.constructor === GC || this.right && this.right.constructor === GC) {
      this.parent = null;
    } else if (!this.parent) {
      if (this.left && this.left.constructor === _Item) {
        this.parent = this.left.parent;
        this.parentSub = this.left.parentSub;
      } else if (this.right && this.right.constructor === _Item) {
        this.parent = this.right.parent;
        this.parentSub = this.right.parentSub;
      }
    } else if (this.parent.constructor === ID) {
      const parentItem = getItem(store, this.parent);
      if (parentItem.constructor === GC) {
        this.parent = null;
      } else {
        this.parent = /** @type {ContentType} */
        parentItem.content.type;
      }
    }
    return null;
  }
  /**
   * @param {Transaction} transaction
   * @param {number} offset
   */
  integrate(transaction, offset) {
    if (offset > 0) {
      this.id.clock += offset;
      this.left = getItemCleanEnd(transaction, transaction.doc.store, createID(this.id.client, this.id.clock - 1));
      this.origin = this.left.lastId;
      this.content = this.content.splice(offset);
      this.length -= offset;
    }
    if (this.parent) {
      if (!this.left && (!this.right || this.right.left !== null) || this.left && this.left.right !== this.right) {
        let left = this.left;
        let o;
        if (left !== null) {
          o = left.right;
        } else if (this.parentSub !== null) {
          o = /** @type {AbstractType<any>} */
          this.parent._map.get(this.parentSub) || null;
          while (o !== null && o.left !== null) {
            o = o.left;
          }
        } else {
          o = /** @type {AbstractType<any>} */
          this.parent._start;
        }
        const conflictingItems = /* @__PURE__ */ new Set();
        const itemsBeforeOrigin = /* @__PURE__ */ new Set();
        while (o !== null && o !== this.right) {
          itemsBeforeOrigin.add(o);
          conflictingItems.add(o);
          if (compareIDs(this.origin, o.origin)) {
            if (o.id.client < this.id.client) {
              left = o;
              conflictingItems.clear();
            } else if (compareIDs(this.rightOrigin, o.rightOrigin)) {
              break;
            }
          } else if (o.origin !== null && itemsBeforeOrigin.has(getItem(transaction.doc.store, o.origin))) {
            if (!conflictingItems.has(getItem(transaction.doc.store, o.origin))) {
              left = o;
              conflictingItems.clear();
            }
          } else {
            break;
          }
          o = o.right;
        }
        this.left = left;
      }
      if (this.left !== null) {
        const right = this.left.right;
        this.right = right;
        this.left.right = this;
      } else {
        let r;
        if (this.parentSub !== null) {
          r = /** @type {AbstractType<any>} */
          this.parent._map.get(this.parentSub) || null;
          while (r !== null && r.left !== null) {
            r = r.left;
          }
        } else {
          r = /** @type {AbstractType<any>} */
          this.parent._start;
          this.parent._start = this;
        }
        this.right = r;
      }
      if (this.right !== null) {
        this.right.left = this;
      } else if (this.parentSub !== null) {
        this.parent._map.set(this.parentSub, this);
        if (this.left !== null) {
          this.left.delete(transaction);
        }
      }
      if (this.parentSub === null && this.countable && !this.deleted) {
        this.parent._length += this.length;
      }
      addStruct(transaction.doc.store, this);
      this.content.integrate(transaction, this);
      addChangedTypeToTransaction(
        transaction,
        /** @type {AbstractType<any>} */
        this.parent,
        this.parentSub
      );
      if (
        /** @type {AbstractType<any>} */
        this.parent._item !== null && /** @type {AbstractType<any>} */
        this.parent._item.deleted || this.parentSub !== null && this.right !== null
      ) {
        this.delete(transaction);
      }
    } else {
      new GC(this.id, this.length).integrate(transaction, 0);
    }
  }
  /**
   * Returns the next non-deleted item
   */
  get next() {
    let n = this.right;
    while (n !== null && n.deleted) {
      n = n.right;
    }
    return n;
  }
  /**
   * Returns the previous non-deleted item
   */
  get prev() {
    let n = this.left;
    while (n !== null && n.deleted) {
      n = n.left;
    }
    return n;
  }
  /**
   * Computes the last content address of this Item.
   */
  get lastId() {
    return this.length === 1 ? this.id : createID(this.id.client, this.id.clock + this.length - 1);
  }
  /**
   * Try to merge two items
   *
   * @param {Item} right
   * @return {boolean}
   */
  mergeWith(right) {
    if (this.constructor === right.constructor && compareIDs(right.origin, this.lastId) && this.right === right && compareIDs(this.rightOrigin, right.rightOrigin) && this.id.client === right.id.client && this.id.clock + this.length === right.id.clock && this.deleted === right.deleted && this.redone === null && right.redone === null && this.content.constructor === right.content.constructor && this.content.mergeWith(right.content)) {
      const searchMarker = (
        /** @type {AbstractType<any>} */
        this.parent._searchMarker
      );
      if (searchMarker) {
        searchMarker.forEach((marker) => {
          if (marker.p === right) {
            marker.p = this;
            if (!this.deleted && this.countable) {
              marker.index -= this.length;
            }
          }
        });
      }
      if (right.keep) {
        this.keep = true;
      }
      this.right = right.right;
      if (this.right !== null) {
        this.right.left = this;
      }
      this.length += right.length;
      return true;
    }
    return false;
  }
  /**
   * Mark this Item as deleted.
   *
   * @param {Transaction} transaction
   */
  delete(transaction) {
    if (!this.deleted) {
      const parent = (
        /** @type {AbstractType<any>} */
        this.parent
      );
      if (this.countable && this.parentSub === null) {
        parent._length -= this.length;
      }
      this.markDeleted();
      addToDeleteSet(transaction.deleteSet, this.id.client, this.id.clock, this.length);
      addChangedTypeToTransaction(transaction, parent, this.parentSub);
      this.content.delete(transaction);
    }
  }
  /**
   * @param {StructStore} store
   * @param {boolean} parentGCd
   */
  gc(store, parentGCd) {
    if (!this.deleted) {
      throw unexpectedCase();
    }
    this.content.gc(store);
    if (parentGCd) {
      replaceStruct(store, this, new GC(this.id, this.length));
    } else {
      this.content = new ContentDeleted(this.length);
    }
  }
  /**
   * Transform the properties of this type to binary and write it to an
   * BinaryEncoder.
   *
   * This is called when this Item is sent to a remote peer.
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder The encoder to write data to.
   * @param {number} offset
   */
  write(encoder2, offset) {
    const origin = offset > 0 ? createID(this.id.client, this.id.clock + offset - 1) : this.origin;
    const rightOrigin = this.rightOrigin;
    const parentSub = this.parentSub;
    const info = this.content.getRef() & BITS5 | (origin === null ? 0 : BIT8) | // origin is defined
    (rightOrigin === null ? 0 : BIT7) | // right origin is defined
    (parentSub === null ? 0 : BIT6);
    encoder2.writeInfo(info);
    if (origin !== null) {
      encoder2.writeLeftID(origin);
    }
    if (rightOrigin !== null) {
      encoder2.writeRightID(rightOrigin);
    }
    if (origin === null && rightOrigin === null) {
      const parent = (
        /** @type {AbstractType<any>} */
        this.parent
      );
      if (parent._item !== void 0) {
        const parentItem = parent._item;
        if (parentItem === null) {
          const ykey = findRootTypeKey(parent);
          encoder2.writeParentInfo(true);
          encoder2.writeString(ykey);
        } else {
          encoder2.writeParentInfo(false);
          encoder2.writeLeftID(parentItem.id);
        }
      } else if (parent.constructor === String) {
        encoder2.writeParentInfo(true);
        encoder2.writeString(parent);
      } else if (parent.constructor === ID) {
        encoder2.writeParentInfo(false);
        encoder2.writeLeftID(parent);
      } else {
        unexpectedCase();
      }
      if (parentSub !== null) {
        encoder2.writeString(parentSub);
      }
    }
    this.content.write(encoder2, offset);
  }
};
var readItemContent = (decoder, info) => contentRefs[info & BITS5](decoder);
var contentRefs = [
  () => {
    unexpectedCase();
  },
  // GC is not ItemContent
  readContentDeleted,
  // 1
  readContentJSON,
  // 2
  readContentBinary,
  // 3
  readContentString,
  // 4
  readContentEmbed,
  // 5
  readContentFormat,
  // 6
  readContentType,
  // 7
  readContentAny,
  // 8
  readContentDoc,
  // 9
  () => {
    unexpectedCase();
  }
  // 10 - Skip is not ItemContent
];
var structSkipRefNumber = 10;
var Skip = class extends AbstractStruct {
  get deleted() {
    return true;
  }
  delete() {
  }
  /**
   * @param {Skip} right
   * @return {boolean}
   */
  mergeWith(right) {
    if (this.constructor !== right.constructor) {
      return false;
    }
    this.length += right.length;
    return true;
  }
  /**
   * @param {Transaction} transaction
   * @param {number} offset
   */
  integrate(transaction, offset) {
    unexpectedCase();
  }
  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write(encoder2, offset) {
    encoder2.writeInfo(structSkipRefNumber);
    writeVarUint(encoder2.restEncoder, this.length - offset);
  }
  /**
   * @param {Transaction} transaction
   * @param {StructStore} store
   * @return {null | number}
   */
  getMissing(transaction, store) {
    return null;
  }
};
var glo = (
  /** @type {any} */
  typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {}
);
var importIdentifier = "__ $YJS$ __";
if (glo[importIdentifier] === true) {
  console.error("Yjs was already imported. This breaks constructor checks and will lead to issues! - https://github.com/yjs/yjs/issues/438");
}
glo[importIdentifier] = true;

// src/crdt.ts
function bufferOf(bytes) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
function replaceText(doc2, nextText) {
  const text2 = doc2.getText("content");
  const current = text2.toString();
  if (current === nextText) return;
  let prefix = 0;
  while (prefix < current.length && prefix < nextText.length && current[prefix] === nextText[prefix]) prefix++;
  if (prefix > 0 && /[\uD800-\uDBFF]/.test(current[prefix - 1] ?? "")) prefix--;
  let suffix = 0;
  while (suffix < current.length - prefix && suffix < nextText.length - prefix && current[current.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]) suffix++;
  if (suffix > 0 && /[\uDC00-\uDFFF]/.test(current[current.length - suffix] ?? "")) suffix--;
  const deleteLength = current.length - prefix - suffix;
  const insert = nextText.slice(prefix, nextText.length - suffix);
  doc2.transact(() => {
    if (deleteLength) text2.delete(prefix, deleteLength);
    if (insert) text2.insert(prefix, insert);
  });
}
function createCrdtSeed(text2) {
  const doc2 = new Doc();
  doc2.getText("content").insert(0, text2);
  return bufferOf(encodeStateAsUpdate(doc2));
}
function mergeCrdtText(updates, localText) {
  const merged = new Doc();
  for (const update of updates) applyUpdate(merged, new Uint8Array(update));
  const stateVector = encodeStateVector(merged);
  const base = encodeStateAsUpdate(merged);
  const localBranch = new Doc();
  applyUpdate(localBranch, base);
  replaceText(localBranch, localText);
  applyUpdate(merged, encodeStateAsUpdate(localBranch));
  const delta = encodeStateAsUpdate(merged, stateVector);
  return {
    text: merged.getText("content").toString(),
    update: bufferOf(delta)
  };
}

// src/types.ts
var DEFAULT_SETTINGS = {
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
  baseline: {}
};

// src/main.ts
function toArrayBuffer4(bytes) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
var MyCloudSyncPlugin = class extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    this.isSyncing = false;
    this.cancelSyncRequested = false;
    this.syncPending = false;
    this.syncDebounceId = null;
    this.scheduledSyncId = null;
    this.logPersistTimeout = null;
  }
  async onload() {
    const stored = await this.loadData();
    const saved = stored && typeof stored === "object" ? stored : {};
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      remoteFolder: typeof saved.remoteFolder === "string" ? saved.remoteFolder : `Obsidian/${this.app.vault.getName()}`,
      baseline: saved.baseline && typeof saved.baseline === "object" ? saved.baseline : {},
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
      syncConcurrency: this.validConcurrency(saved.syncConcurrency, import_obsidian2.Platform.isMobile ? 2 : 5),
      syncRecoveryPending: saved.syncRecoveryPending === true,
      ribbonAction: saved.ribbonAction === "settings" ? "settings" : "sync",
      logText: typeof saved.logText === "string" ? saved.logText.split("\n").slice(-500).join("\n") : ""
    };
    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: () => this.syncNow(true)
    });
    this.addCommand({ id: "cancel-sync", name: "Cancel cloud sync", callback: () => this.cancelSync() });
    this.addCommand({ id: "emergency-stop-sync", name: "Emergency stop cloud sync", callback: () => this.cancelSync() });
    this.addRibbonIcon("cloud", "My Cloud Sync", () => {
      if (this.settings.ribbonAction === "settings") this.openPluginSettings();
      else void this.syncNow(true);
    });
    this.addSettingTab(new MyCloudSyncSettingTab(this.app, this));
    this.registerEvent(this.app.vault.on("create", () => this.scheduleSync()));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof import_obsidian2.TFile && this.shouldSync(file.path, file.stat.size)) {
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
      new import_obsidian2.Notice("An interrupted sync was found. Resuming cloud sync\u2026");
      window.setTimeout(() => void this.syncNow(), 1200);
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async exportSettingsFile() {
    const payload = {
      format: "OCloudSync settings",
      formatVersion: 1,
      pluginVersion: this.manifest.version,
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      settings: {
        ...this.settings,
        deviceId: "",
        baseline: {},
        logText: "",
        syncRecoveryPending: false
      }
    };
    const content = JSON.stringify(payload, null, 2);
    const safeVaultName = this.app.vault.getName().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "vault";
    const date = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const fileName = `OCloudSync-${safeVaultName}-settings-${date}.json`;
    const file = new File([content], fileName, { type: "application/json" });
    if (import_obsidian2.Platform.isMobile && navigator.share && navigator.canShare?.({ files: [file] })) {
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
      window.setTimeout(() => URL.revokeObjectURL(url), 3e4);
    }
    this.addLog("Settings exported to a JSON file.");
  }
  async importSettingsFile(file) {
    if (this.isSyncing) throw new Error("Stop the current sync before importing settings.");
    if (file.size > 2 * 1024 * 1024) throw new Error("The settings file is unexpectedly large (over 2 MB).");
    const payload = JSON.parse(await file.text());
    if (payload?.format !== "OCloudSync settings" || payload.formatVersion !== 1) {
      throw new Error("This is not a supported OCloudSync settings export.");
    }
    if (!payload.settings || typeof payload.settings !== "object" || Array.isArray(payload.settings)) {
      throw new Error("The export does not contain a valid settings object.");
    }
    const source = payload.settings;
    const imported = { ...DEFAULT_SETTINGS };
    const target = imported;
    for (const [key, defaultValue] of Object.entries(DEFAULT_SETTINGS)) {
      if (["baseline", "logText", "syncRecoveryPending", "deviceId"].includes(key)) continue;
      const value = source[key];
      if (typeof defaultValue === "string" && typeof value === "string") target[key] = value;
      else if (typeof defaultValue === "number" && typeof value === "number" && Number.isFinite(value)) target[key] = value;
      else if (typeof defaultValue === "boolean" && typeof value === "boolean") target[key] = value;
    }
    const providers = ["webdav", "google-drive", "s3", "azure-blob", "dropbox", "onedrive", "yandex-disk", "pcloud", "webdis", "box"];
    const conflictActions = ["keep-newer", "keep-larger", "keep-both", "merge-markdown", "crdt", "prefer-local"];
    imported.provider = providers.includes(String(source.provider)) ? source.provider : DEFAULT_SETTINGS.provider;
    imported.deviceId = this.settings.deviceId;
    imported.conflictAction = conflictActions.includes(String(source.conflictAction)) ? source.conflictAction : DEFAULT_SETTINGS.conflictAction;
    imported.encryptionMethod = source.encryptionMethod === "openssl-aes-cbc" ? "openssl-aes-cbc" : "aes-gcm";
    imported.encryptionMethodTarget = source.encryptionMethodTarget === "openssl-aes-cbc" ? "openssl-aes-cbc" : "aes-gcm";
    imported.pcloudRegion = source.pcloudRegion === "eu" ? "eu" : "us";
    imported.syncDeleteLocation = source.syncDeleteLocation === "system" ? "system" : "obsidian";
    imported.ribbonAction = source.ribbonAction === "settings" ? "settings" : "sync";
    imported.scheduledSyncMinutes = this.validInterval(source.scheduledSyncMinutes);
    imported.maxFileSizeMb = this.validMaxSize(source.maxFileSizeMb);
    imported.syncConcurrency = this.validConcurrency(source.syncConcurrency, import_obsidian2.Platform.isMobile ? 2 : 5);
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
  addLog(message, level = "INFO") {
    const cleanMessage = message.replace(/[\r\n]+/g, " ").trim();
    const line = `[${(/* @__PURE__ */ new Date()).toLocaleString()}] [${level}] ${cleanMessage}`;
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
  setLogView(textarea) {
    this.logTextArea = textarea;
  }
  validInterval(value) {
    const options = [2, 5, 10, 20, 30];
    if (typeof value !== "number" || !Number.isFinite(value)) return 30;
    return options.reduce((closest, option) => Math.abs(option - value) < Math.abs(closest - value) ? option : closest, options[0]);
  }
  validMaxSize(value) {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(102400, value)) : 0;
  }
  validConcurrency(value, fallback = 5) {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.min(20, Math.floor(value))) : fallback;
  }
  refreshScheduledSync() {
    if (this.scheduledSyncId !== null) window.clearInterval(this.scheduledSyncId);
    this.scheduledSyncId = null;
    if (this.settings.scheduledSync) {
      this.scheduledSyncId = window.setInterval(() => {
        if (!this.isSyncing) void this.syncNow();
      }, this.settings.scheduledSyncMinutes * 6e4);
    }
  }
  shouldSync(path, size2) {
    if (path.startsWith(".trash/") || path === ".trash") return false;
    const configDir = this.app.vault.configDir;
    if (path === `${configDir}/bookmarks.json`) return this.settings.syncBookmarks;
    if (path.startsWith(`${configDir}/`) || path === configDir) return this.settings.syncConfigFolder;
    if (path.split("/").some((part) => part.startsWith("."))) return false;
    if (!this.settings.includeUnderscorePaths && path.split("/").some((part) => part.startsWith("_"))) return false;
    const limit = this.settings.maxFileSizeMb * 1024 * 1024;
    const encryptionOverhead = this.settings.encryptionPassword ? 48 : 0;
    if (limit > 0 && size2 > limit + encryptionOverhead) return false;
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
  async setAutoSync(enabled) {
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
  scheduleSync(force = false) {
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
  async getLocalFiles() {
    return this.app.vault.getFiles().filter((file) => this.shouldSync(file.path, file.stat.size)).map((file) => ({
      path: file.path,
      mtime: file.stat.mtime,
      size: file.stat.size,
      isFolder: false
    }));
  }
  async readLocal(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian2.TFile)) {
      throw new Error(`Local file disappeared during sync: ${path}`);
    }
    return this.app.vault.readBinary(file);
  }
  async writeLocal(path, data) {
    if (path.startsWith("/") || path.split("/").some((segment) => segment === "." || segment === "..") || !this.shouldSync(path, data.byteLength)) {
      throw new Error(`Refusing to write an unsafe vault path: ${path}`);
    }
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof import_obsidian2.TFile) {
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
  async syncNow(manual = false) {
    if (this.isSyncing) {
      new import_obsidian2.Notice("A cloud sync is already running.");
      return;
    }
    this.cancelSyncRequested = false;
    if (this.syncDebounceId !== null) {
      window.clearTimeout(this.syncDebounceId);
      this.syncDebounceId = null;
    }
    this.isSyncing = true;
    this.updateSyncToggleButton();
    new import_obsidian2.Notice("Cloud sync started.");
    this.addLog(`Sync started${manual ? " (manual)" : " (automatic)"}.`);
    this.settings.syncRecoveryPending = true;
    let completed = false;
    try {
      await this.saveSettings();
      const provider = createProvider(this.settings);
      const password = this.settings.encryptionPassword;
      const existingRemotePaths = /* @__PURE__ */ new Map();
      const remotePath = (path) => password ? encryptPath(path, password, this.settings.encryptionMethod) : Promise.resolve(path);
      const listRemote = async () => {
        const files = await provider.list();
        const mapped = await Promise.all(files.map(async (file) => {
          const path = password ? await decryptPath(file.path, password) : file.path;
          existingRemotePaths.set(path, file.path);
          return { ...file, path };
        }));
        return mapped;
      };
      const readRemoteData = async (path) => {
        const remoteData = await provider.read(existingRemotePaths.get(path) ?? await remotePath(path));
        return password ? decryptFile(remoteData, password) : remoteData;
      };
      const writeRemoteData = async (path, data, mtime) => {
        const oldPath = existingRemotePaths.get(path);
        const encryptedPath = await remotePath(path);
        await provider.write(encryptedPath, password ? await encryptFileWithMethod(data, password, this.settings.encryptionMethod) : data, mtime);
        if (password && oldPath && oldPath !== encryptedPath) await provider.delete(oldPath);
        existingRemotePaths.set(path, encryptedPath);
      };
      const deleteRemoteData = async (path) => provider.delete(existingRemotePaths.get(path) ?? await remotePath(path));
      const localFiles = await this.getLocalFiles();
      const allRemoteFiles = await listRemote();
      if (this.settings.conflictAction === "prefer-local") {
        const primaryPath = ".ocs-system/primary-device.json";
        const markerExists = allRemoteFiles.some((file) => file.path === primaryPath);
        let primary;
        if (markerExists) {
          try {
            const remoteData = await provider.read(await remotePath(primaryPath));
            const markerData = password ? await decryptFile(remoteData, password) : remoteData;
            primary = JSON.parse(new TextDecoder().decode(markerData));
          } catch {
            throw new Error("Cannot verify the primary device marker. Resolve the cloud marker before using Prefer this device.");
          }
          if (primary.deviceId !== this.settings.deviceId) {
            throw new Error("Another device is already designated as primary. Only that device may use Prefer this device.");
          }
        } else {
          const marker = new TextEncoder().encode(JSON.stringify({ deviceId: this.settings.deviceId, claimedAt: Date.now() }));
          const markerBuffer = toArrayBuffer4(marker);
          const encryptedMarker = password ? await encryptFileWithMethod(markerBuffer, password, this.settings.encryptionMethod) : markerBuffer;
          await provider.write(await remotePath(primaryPath), encryptedMarker, Date.now());
          const verificationData = await provider.read(await remotePath(primaryPath));
          const plainVerification = password ? await decryptFile(verificationData, password) : verificationData;
          primary = JSON.parse(new TextDecoder().decode(plainVerification));
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
        return local.mtime !== previous.local.mtime || local.size !== previous.local.size || remote.mtime !== previous.remote.mtime || remote.size !== previous.remote.size;
      }).length;
      if (knownPaths.length > 0 && changedKnownFiles * 2 >= knownPaths.length) {
        const warning = `This sync may change or remove ${changedKnownFiles} of ${knownPaths.length} previously synced files. Continue?`;
        if (!manual) {
          this.settings.syncRecoveryPending = false;
          throw new Error("SYNC_PROTECTED");
        }
        const confirmed = await new Promise((resolve) => {
          new ConfirmModal(this.app, warning, () => resolve(true), () => resolve(false)).open();
        });
        if (!confirmed) throw new Error("SYNC_PROTECTED");
      }
      const crdtPrefix = async (path) => {
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(path)));
        let binary = "";
        for (const byte of digest) binary += String.fromCharCode(byte);
        const hash = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
        return `.my-cloud-sync-crdt/${hash}/`;
      };
      const crdtManagedPaths = /* @__PURE__ */ new Set();
      for (const remote of remoteFiles) {
        const path = remote.path;
        if (this.settings.conflictAction !== "crdt" || !path.toLowerCase().endsWith(".md") || !localByPath.has(path)) continue;
        if (this.cancelSyncRequested) throw new Error("SYNC_CANCELLED");
        const prefix = await crdtPrefix(path);
        let stateFiles = allRemoteFiles.filter((file) => file.path.startsWith(prefix));
        const localText = new TextDecoder("utf-8", { fatal: true }).decode(await this.readLocal(path));
        if (!stateFiles.length) {
          const remoteText2 = new TextDecoder("utf-8", { fatal: true }).decode(await readRemoteData(path));
          const seedPath = `${prefix}${crypto.randomUUID()}.yjs`;
          await writeRemoteData(seedPath, createCrdtSeed(remoteText2), Date.now());
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
        const mergedBuffer = toArrayBuffer4(mergedBytes);
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
          remoteFiles: (await listRemote()).filter((file) => this.shouldSync(file.path, file.size))
        }),
        this.settings.conflictAction,
        deleteRemoteData,
        async (path) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof import_obsidian2.TFile) await this.app.fileManager.trashFile(file);
        },
        this.settings.syncDeletions,
        () => this.cancelSyncRequested,
        import_obsidian2.Platform.isMobile ? Math.min(this.settings.syncConcurrency, 3) : this.settings.syncConcurrency
      );
      if (this.settings.conflictAction === "crdt") {
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
          const text2 = new TextDecoder("utf-8", { fatal: true }).decode(localData);
          await writeRemoteData(`${prefix}${crypto.randomUUID()}.yjs`, createCrdtSeed(text2), Date.now());
        }
      }
      const conflictSummary = result.conflicts.length ? `; conflicts left untouched: ${result.conflicts.join(", ")}` : "";
      new import_obsidian2.Notice(
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
        new import_obsidian2.Notice("Sync paused. Run Sync now to continue.");
      } else if (message === "SYNC_PROTECTED") {
        this.addLog("Sync stopped by the safety check because it could modify or remove many files.", "WARN");
        this.settings.syncRecoveryPending = false;
        new import_obsidian2.Notice("Sync stopped because it would change many files. Start it manually and confirm to continue.");
      } else {
        this.addLog(`Sync failed: ${message}`, "ERROR");
        new import_obsidian2.Notice(`Cloud sync failed: ${message}`);
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
  cancelSync() {
    if (!this.isSyncing) {
      new import_obsidian2.Notice("No cloud sync is running.");
      return;
    }
    this.cancelSyncRequested = true;
    this.syncPending = false;
    if (this.syncDebounceId !== null) {
      window.clearTimeout(this.syncDebounceId);
      this.syncDebounceId = null;
    }
    new import_obsidian2.Notice("Stopping after the current file operations finish\u2026");
  }
  get syncRunning() {
    return this.isSyncing;
  }
  openPluginSettings() {
    const settingManager = this.app.setting;
    if (!settingManager) {
      new import_obsidian2.Notice("Could not open plugin settings.");
      return;
    }
    settingManager.open();
    settingManager.openTabById(this.manifest.id);
  }
  bindSyncToggleButton(button) {
    this.syncToggleButton = button;
    this.updateSyncToggleButton();
  }
  updateSyncToggleButton() {
    if (!this.syncToggleButton) return;
    this.syncToggleButton.setButtonText(this.isSyncing ? "Cancel sync" : "Start sync");
    if (this.isSyncing) this.syncToggleButton.removeCta();
    else this.syncToggleButton.setCta();
  }
  async encryptRemoteStorage(oldPassword, newPassword) {
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
      let oldLogicalPath;
      try {
        oldLogicalPath = await decryptPath(file.path, newPassword);
      } catch {
        oldLogicalPath = await decryptPath(file.path, oldPassword);
      }
      const data = await provider.read(file.path);
      let plain = data;
      try {
        plain = await decryptFile(data, newPassword || oldPassword);
      } catch {
        plain = await decryptFile(data, oldPassword);
      }
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
};
var ConfirmModal = class extends import_obsidian2.Modal {
  constructor(app, message, confirm, cancel = () => {
  }) {
    super(app);
    this.message = message;
    this.confirm = confirm;
    this.cancel = cancel;
    this.settled = false;
  }
  onOpen() {
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
  onClose() {
    if (!this.settled) this.cancel();
    this.contentEl.empty();
  }
};
var MyCloudSyncSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.currentPage = "main";
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.addClass("ocs-settings");
    this.plugin.setLogView();
    containerEl.empty();
    new import_obsidian2.Setting(containerEl).setName(this.plugin.manifest.name).setHeading();
    const pageNav = new import_obsidian2.Setting(containerEl);
    pageNav.settingEl.addClass("ocs-page-nav");
    pageNav.infoEl.hide();
    pageNav.addButton((button) => {
      button.setButtonText("Main");
      if (this.currentPage === "main") button.setCta();
      else button.removeCta();
      return button.onClick(() => {
        this.currentPage = "main";
        this.display();
      });
    }).addButton((button) => {
      button.setButtonText("Pro settings");
      if (this.currentPage === "pro") button.setCta();
      else button.removeCta();
      return button.onClick(() => {
        this.currentPage = "pro";
        this.display();
      });
    }).addButton((button) => {
      button.setButtonText("Log");
      if (this.currentPage === "log") button.setCta();
      else button.removeCta();
      return button.onClick(() => {
        this.currentPage = "log";
        this.display();
      });
    }).addButton((button) => {
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
    new import_obsidian2.Setting(containerEl).setName("General").setHeading();
    new import_obsidian2.Setting(containerEl).setName("Cloud provider").setDesc("Choose a connected cloud service for this vault.").addDropdown(
      (dropdown) => dropdown.addOption("webdav", "WebDAV (Nextcloud, ownCloud, etc.)").addOption("google-drive", "Google Drive").addOption("s3", "S3-compatible storage (AWS, Cloudflare R2, MinIO, etc.)").addOption("azure-blob", "Azure Blob Storage").addOption("dropbox", "Dropbox").addOption("onedrive", "OneDrive Personal (app folder)").addOption("yandex-disk", "Yandex Disk").addOption("pcloud", "pCloud").addOption("webdis", "Webdis (Redis HTTP gateway)").addOption("box", "Box").setValue(this.plugin.settings.provider).onChange(async (value) => {
        if (value !== "webdav" && value !== "google-drive" && value !== "s3" && value !== "azure-blob" && value !== "dropbox" && value !== "onedrive" && value !== "yandex-disk" && value !== "pcloud" && value !== "webdis" && value !== "box") {
          throw new Error(`Unsupported cloud provider: ${value}`);
        }
        this.plugin.settings.provider = value;
        this.plugin.settings.baseline = {};
        await this.plugin.saveSettings();
        this.display();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Remote folder").setDesc("Folder path on the cloud. It is created automatically if needed.").addText(
      (text2) => text2.setPlaceholder("Obsidian").setValue(this.plugin.settings.remoteFolder).onChange(async (value) => {
        const nextFolder = value.trim();
        if (nextFolder !== this.plugin.settings.remoteFolder) {
          this.plugin.settings.baseline = {};
        }
        this.plugin.settings.remoteFolder = nextFolder;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Automatic sync").setDesc("Debounce vault changes and sync automatically.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.autoSync).onChange((enabled) => this.plugin.setAutoSync(enabled))
    );
    new import_obsidian2.Setting(containerEl).setName("Sync on file save").setDesc("Start a debounced sync after a vault file is modified.").addToggle((toggle) => toggle.setValue(this.plugin.settings.syncOnSave).onChange(async (enabled) => {
      this.plugin.settings.syncOnSave = enabled;
      await this.plugin.saveSettings();
    }));
    const scheduledSyncGroup = containerEl.createDiv();
    scheduledSyncGroup.addClass("ocs-settings-group");
    new import_obsidian2.Setting(scheduledSyncGroup).setName("Scheduled sync").setDesc("Run a sync at a regular interval while Obsidian is open.").addToggle((toggle) => toggle.setValue(this.plugin.settings.scheduledSync).onChange(async (enabled) => {
      this.plugin.settings.scheduledSync = enabled;
      this.plugin.refreshScheduledSync();
      await this.plugin.saveSettings();
      this.display();
    }));
    if (this.plugin.settings.scheduledSync) {
      new import_obsidian2.Setting(scheduledSyncGroup).setName("Sync interval (minutes)").setDesc("Choose how often scheduled sync runs.").addDropdown((dropdown) => dropdown.addOption("2", "2 min").addOption("5", "5 min").addOption("10", "10 min").addOption("20", "20 min").addOption("30", "30 min").setValue(String(this.plugin.settings.scheduledSyncMinutes)).onChange(async (value) => {
        this.plugin.settings.scheduledSyncMinutes = this.plugin.validInterval(Number(value));
        this.plugin.refreshScheduledSync();
        await this.plugin.saveSettings();
      }));
    }
    new import_obsidian2.Setting(containerEl).setName("Excluded path patterns").setDesc("One JavaScript regular expression per line. Matching vault paths are skipped.").addTextArea((text2) => text2.setPlaceholder("^Private/\\n\\.secret").setValue(this.plugin.settings.ignorePatterns).onChange(async (value) => {
      this.plugin.settings.ignorePatterns = value;
      await this.plugin.saveSettings();
    }));
    const pathSyncGroup = containerEl.createDiv();
    pathSyncGroup.addClass("ocs-settings-group");
    for (const [key, title, description] of [
      ["includeUnderscorePaths", "Sync underscore paths", "Include files and folders whose names start with underscore."],
      ["syncConfigFolder", "Sync Obsidian configuration folder", `Experimental: sync all of ${this.app.vault.configDir}. Changes may vary between devices.`],
      ["syncBookmarks", "Sync bookmarks", `Sync ${this.app.vault.configDir}/bookmarks.json without syncing the rest of the configuration folder.`]
    ]) {
      new import_obsidian2.Setting(pathSyncGroup).setName(title).setDesc(description).addToggle((toggle) => toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
        this.plugin.settings[key] = value;
        await this.plugin.saveSettings();
      }));
    }
    new import_obsidian2.Setting(containerEl).setName("Conflict choice").setDesc("Choose how conflicting changes are handled. CRDT merges concurrent Markdown edits; other files use the selected file-level policy.").addDropdown((dropdown) => dropdown.addOption("keep-newer", "Keep newer").addOption("keep-larger", "Keep larger").addOption("keep-both", "Keep both copies").addOption("merge-markdown", "Merge Markdown; keep both if edits overlap").addOption("crdt", "CRDT merge (Markdown)").addOption("prefer-local", "Prefer this device (local changes win)").setValue(this.plugin.settings.conflictAction).onChange(async (value) => {
      if (value === "keep-newer" || value === "keep-larger" || value === "keep-both" || value === "merge-markdown" || value === "crdt" || value === "prefer-local") {
        this.plugin.settings.conflictAction = value;
        await this.plugin.saveSettings();
      }
    }));
    new import_obsidian2.Setting(containerEl).setName("End-to-end encryption password").setDesc("Vault file contents and remote file/folder names are encrypted before upload with the method selected in Pro settings. Use the same password and method on every device.").addText((text2) => {
      text2.inputEl.type = "password";
      text2.setPlaceholder("Leave empty to disable encryption");
      text2.setValue(this.plugin.settings.encryptionPassword);
      this.passwordInput = text2.inputEl;
    }).addExtraButton((button) => button.setIcon("eye").setTooltip("Show password").onClick(() => {
      const input = this.passwordInput;
      if (!input) return;
      const showPassword = input.type === "password";
      input.type = showPassword ? "text" : "password";
      button.setIcon(showPassword ? "eye-off" : "eye");
      button.setTooltip(showPassword ? "Hide password" : "Show password");
    })).addButton((button) => button.setButtonText("Encrypt / convert").onClick(() => {
      const nextPassword = this.passwordInput?.value ?? "";
      const oldPassword = this.plugin.settings.encryptionPassword;
      if (nextPassword === oldPassword && this.plugin.settings.encryptionMethod === this.plugin.settings.encryptionMethodTarget) {
        new import_obsidian2.Notice("That encryption password is already active.");
        return;
      }
      new ConfirmModal(this.app, "This will rewrite every remote file and encrypt or decrypt its contents and path names using the selected method. Continue?", async () => {
        if (this.plugin.syncRunning) this.plugin.cancelSync();
        while (this.plugin.syncRunning) await new Promise((resolve) => window.setTimeout(resolve, 100));
        try {
          new import_obsidian2.Notice("Encrypting remote storage\u2026");
          await this.plugin.encryptRemoteStorage(oldPassword, nextPassword);
          new import_obsidian2.Notice("Remote storage encryption complete.");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          new import_obsidian2.Notice(`Storage encryption stopped: ${message}. Apply the same password again to continue.`);
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
    new import_obsidian2.Setting(containerEl).setName("Sync now").setDesc("Only changed files are transferred. Markdown files use CRDT updates to merge concurrent edits; cloud providers still store each changed Markdown file as a whole object.").addButton((button) => {
      this.plugin.bindSyncToggleButton(button);
      button.onClick(() => {
        if (this.plugin.syncRunning) {
          this.plugin.cancelSync();
          button.setButtonText("Stopping\u2026");
          button.removeCta();
        } else {
          void this.plugin.syncNow(true);
        }
      });
    });
  }
  displayLog(containerEl) {
    new import_obsidian2.Setting(containerEl).setName("Extension log").setHeading();
    containerEl.createEl("p", { text: "Recent sync activity and errors. The log is stored in this vault's plugin settings and keeps the latest 500 lines." });
    const textarea = containerEl.createEl("textarea", { cls: "ocs-log-textarea", attr: { rows: import_obsidian2.Platform.isMobile ? "14" : "22", readonly: "true", spellcheck: "false" } });
    textarea.addClass("ocs-log-textarea");
    textarea.value = this.plugin.settings.logText;
    textarea.scrollTop = textarea.scrollHeight;
    this.plugin.setLogView(textarea);
    const actions = new import_obsidian2.Setting(containerEl);
    actions.infoEl.hide();
    actions.addButton((button) => button.setButtonText("Select log").onClick(() => {
      textarea.focus();
      textarea.select();
      new import_obsidian2.Notice("Log selected. Use your device's copy command.");
    })).addButton((button) => button.setButtonText("Clear log").onClick(async () => {
      this.plugin.settings.logText = "";
      textarea.value = "";
      await this.plugin.saveSettings();
      new import_obsidian2.Notice("Log cleared.");
    }));
  }
  displayExport(containerEl) {
    new import_obsidian2.Setting(containerEl).setName("Export and import").setHeading();
    containerEl.createEl("p", { text: "Download all OCloudSync settings as one JSON file. On mobile, the system share sheet lets you save the file to Files or another location." });
    const warning = containerEl.createEl("div", { cls: "ocs-export-warning" });
    warning.createEl("strong", { text: "Sensitive file" });
    warning.createEl("p", { text: "The export includes cloud passwords, OAuth tokens, access keys, and the encryption password. Anyone with this file can access those accounts and data. Store it securely and delete it when you no longer need it." });
    const fileInput = containerEl.createEl("input", { cls: "ocs-hidden-file-input", attr: { type: "file", accept: ".json,application/json" } });
    let importButton;
    const importSetting = new import_obsidian2.Setting(containerEl).setName("Settings import").setDesc("Choose an OCloudSync JSON export. Sync history will be reset so the next sync can compare files afresh.").addButton((button) => {
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
          new import_obsidian2.Notice("Settings imported. Review the provider, then choose Sync now when ready.");
          this.display();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.plugin.addLog(`Settings import failed: ${message}`, "ERROR");
          new import_obsidian2.Notice(`Settings import failed: ${message}`);
        } finally {
          fileInput.value = "";
          if (importSetting.settingEl.isConnected) importButton.setDisabled(false);
        }
      })();
    });
    new import_obsidian2.Setting(containerEl).setName("Settings export").setDesc("Creates one portable JSON file. Sync history and the log are left out.").addButton((button) => button.setButtonText("Export settings file").setCta().onClick(async () => {
      button.setDisabled(true);
      try {
        await this.plugin.exportSettingsFile();
        new import_obsidian2.Notice("Settings export created.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.plugin.addLog(`Settings export failed: ${message}`, "ERROR");
        new import_obsidian2.Notice(`Settings export failed: ${message}`);
      } finally {
        button.setDisabled(false);
      }
    }));
  }
  displayProSettings(containerEl) {
    new import_obsidian2.Setting(containerEl).setName("Advanced").setHeading();
    new import_obsidian2.Setting(containerEl).setName("Encryption format").setHeading();
    new import_obsidian2.Setting(containerEl).setName("Encryption method").setDesc(`Active: ${this.plugin.settings.encryptionMethod === "openssl-aes-cbc" ? "OpenSSL AES-256-CBC" : "AES-256-GCM"}. AES-GCM is recommended. OpenSSL AES-CBC is provided for openssl enc compatibility, but does not authenticate data. Choose a format, then apply it to convert remote files.`).addDropdown((dropdown) => dropdown.addOption("aes-gcm", "AES-256-GCM (recommended)").addOption("openssl-aes-cbc", "OpenSSL AES-256-CBC").setValue(this.plugin.settings.encryptionMethodTarget).onChange(async (value) => {
      this.plugin.settings.encryptionMethodTarget = value === "openssl-aes-cbc" ? "openssl-aes-cbc" : "aes-gcm";
      await this.plugin.saveSettings();
    })).addButton((button) => button.setButtonText("Apply").onClick(() => {
      const methodLabel = this.plugin.settings.encryptionMethodTarget === "openssl-aes-cbc" ? "OpenSSL AES-256-CBC" : "AES-256-GCM";
      new ConfirmModal(this.app, `Convert the remote storage to ${methodLabel}? This rewrites remote files using the current encryption password. Keep a backup before changing formats.`, async () => {
        if (this.plugin.syncRunning) this.plugin.cancelSync();
        while (this.plugin.syncRunning) await new Promise((resolve) => window.setTimeout(resolve, 100));
        try {
          await this.plugin.encryptRemoteStorage(this.plugin.settings.encryptionPassword, this.plugin.settings.encryptionPassword);
          this.plugin.addLog(`Remote encryption format converted to ${methodLabel}.`);
          new import_obsidian2.Notice(`Remote storage converted to ${methodLabel}.`);
          this.display();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.plugin.addLog(`Encryption conversion failed: ${message}`, "ERROR");
          new import_obsidian2.Notice(`Encryption conversion failed: ${message}. Reapply the same method to continue.`);
        }
      }).open();
    }));
    new import_obsidian2.Setting(containerEl).setName("Parallel file transfers").setDesc(`Maximum number of files uploaded, downloaded, or reconciled at once. Lower this value if your cloud service limits requests. Default: 5.${import_obsidian2.Platform.isMobile ? " Mobile sync is capped at 3 simultaneous files to reduce memory and connection pressure." : ""}`).addDropdown((dropdown) => {
      for (const count of [1, 2, 3, 5, 8, 10, 15, 20]) dropdown.addOption(String(count), count === 5 ? "5 (default)" : String(count));
      dropdown.setValue(String(this.plugin.settings.syncConcurrency)).onChange(async (value) => {
        this.plugin.settings.syncConcurrency = this.plugin.validConcurrency(Number(value));
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian2.Setting(containerEl).setName("Sidebar icon action").setDesc("Choose whether the My Cloud Sync sidebar icon starts synchronization or opens this plugin's settings.").addDropdown((dropdown) => dropdown.addOption("sync", "Start sync").addOption("settings", "Open plugin settings").setValue(this.plugin.settings.ribbonAction).onChange(async (value) => {
      this.plugin.settings.ribbonAction = value === "settings" ? "settings" : "sync";
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Maximum file size (MB)").setDesc("Files larger than this are skipped. Set to 0 for no limit.").addText((text2) => {
      text2.inputEl.type = "number";
      text2.inputEl.min = "0";
      text2.setValue(String(this.plugin.settings.maxFileSizeMb));
      text2.onChange(async (value) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) {
          this.plugin.settings.maxFileSizeMb = this.plugin.validMaxSize(parsed);
          await this.plugin.saveSettings();
        }
      });
    });
    new import_obsidian2.Setting(containerEl).setName("Synchronize deletions").setDesc("A deletion on either side is applied to the other side after a path has been synchronized at least once.").addToggle((toggle) => toggle.setValue(this.plugin.settings.syncDeletions).onChange(async (enabled) => {
      this.plugin.settings.syncDeletions = enabled;
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Move deleted vault files to").setDesc("When a cloud-side deletion is synchronized to this vault, move the local file to the selected trash location.").addDropdown((dropdown) => dropdown.addOption("obsidian", "Obsidian trash").addOption("system", "System trash (fallback to Obsidian trash)").setValue(this.plugin.settings.syncDeleteLocation).onChange(async (value) => {
      this.plugin.settings.syncDeleteLocation = value === "system" ? "system" : "obsidian";
      await this.plugin.saveSettings();
    }));
  }
  displayWebDavSettings(containerEl) {
    new import_obsidian2.Setting(containerEl).setName("WebDAV connection").setHeading();
    new import_obsidian2.Setting(containerEl).setName("WebDAV server URL").setDesc("Use HTTPS, for example https://cloud.example.com/remote.php/dav/files/user/").addText(
      (text2) => text2.setPlaceholder("https://cloud.example.com/remote.php/dav/files/user/").setValue(this.plugin.settings.webdavUrl).onChange(async (value) => {
        const nextUrl = value.trim();
        if (nextUrl !== this.plugin.settings.webdavUrl) {
          this.plugin.settings.baseline = {};
        }
        this.plugin.settings.webdavUrl = nextUrl;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Username").addText(
      (text2) => text2.setValue(this.plugin.settings.webdavUsername).onChange(async (value) => {
        if (value !== this.plugin.settings.webdavUsername) {
          this.plugin.settings.baseline = {};
        }
        this.plugin.settings.webdavUsername = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Password").addText((text2) => {
      text2.inputEl.type = "password";
      text2.setValue(this.plugin.settings.webdavPassword).onChange(async (value) => {
        if (value !== this.plugin.settings.webdavPassword) {
          this.plugin.settings.baseline = {};
        }
        this.plugin.settings.webdavPassword = value;
        await this.plugin.saveSettings();
      });
    });
  }
  displayS3Settings(containerEl) {
    containerEl.createEl("p", { text: "Use an AWS S3 bucket or an S3-compatible service. Leave endpoint blank for AWS; custom services usually require an endpoint URL and path-style addressing." });
    const fields = [
      ["s3Bucket", "Bucket", "my-obsidian-vault"],
      ["s3Region", "Region", "us-east-1"],
      ["s3Endpoint", "Endpoint URL (optional)", "https://s3.example.com"],
      ["s3AccessKey", "Access key ID", "Access key ID"],
      ["s3SecretKey", "Secret access key", "Secret access key", true]
    ];
    for (const [key, name, placeholder, password] of fields) {
      new import_obsidian2.Setting(containerEl).setName(name).addText((text2) => {
        if (password) text2.inputEl.type = "password";
        text2.setPlaceholder(placeholder).setValue(String(this.plugin.settings[key]));
        text2.onChange(async (value) => {
          this.plugin.settings[key] = value.trim();
          await this.plugin.saveSettings();
        });
      });
    }
  }
  displayAzureSettings(containerEl) {
    containerEl.createEl("p", { text: "Create a container SAS URL with read, write, list, and delete permissions. The SAS URL is stored in this vault's plugin settings." });
    new import_obsidian2.Setting(containerEl).setName("Container SAS URL").addText((text2) => {
      text2.inputEl.type = "password";
      text2.setPlaceholder("https://account.blob.core.windows.net/container?sv=...").setValue(this.plugin.settings.azureSasUrl);
      text2.onChange(async (value) => {
        this.plugin.settings.azureSasUrl = value.trim();
        await this.plugin.saveSettings();
      });
    });
  }
  displayDropboxSettings(containerEl) {
    containerEl.createEl("p", {
      text: this.plugin.settings.dropboxAppKey ? this.plugin.settings.dropboxRefreshToken ? "Dropbox is connected. Reconnect any time with one click." : "Connect your Dropbox account with one click." : "First, create a Dropbox app and paste its app key below. You only need to do this once."
    });
    if (!this.plugin.settings.dropboxAppKey) {
      new import_obsidian2.Setting(containerEl).setName("One-time setup").setDesc(`In Dropbox, create a Scoped access app with Full Dropbox access. Enable account_info.read, files.metadata.read, files.content.read, and files.content.write.${import_obsidian2.Platform.isMobile ? "" : " Add redirect URI http://localhost:53683/dropbox-callback."}`).addButton((button) => button.setButtonText("Create Dropbox app").setCta().onClick(() => window.open("https://www.dropbox.com/developers/apps/create")));
    }
    new import_obsidian2.Setting(containerEl).setName("Dropbox app key").addText((text2) => text2.setPlaceholder("Dropbox app key").setValue(this.plugin.settings.dropboxAppKey).onChange(async (value) => {
      this.plugin.settings.dropboxAppKey = value.trim();
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Dropbox account").setDesc(this.plugin.settings.dropboxRefreshToken ? "Dropbox is connected." : import_obsidian2.Platform.isMobile ? "Sign in in the browser, then paste the one-time Dropbox code back into Obsidian." : "Connect your Dropbox account to authorize file access.").addButton((button) => button.setButtonText(this.plugin.settings.dropboxRefreshToken ? "Reconnect Dropbox" : "Connect Dropbox").onClick(async () => {
      button.setDisabled(true);
      try {
        await connectDropbox(this.plugin.settings, this.app);
        this.plugin.settings.baseline = {};
        await this.plugin.saveSettings();
        this.plugin.addLog("Dropbox account connected.");
        new import_obsidian2.Notice("Dropbox connected.");
        this.display();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.plugin.addLog(`Dropbox connection failed: ${message}`, "ERROR");
        new import_obsidian2.Notice(`Dropbox connection failed: ${message}`);
      } finally {
        button.setDisabled(false);
      }
    })).addButton((button) => button.setButtonText("Disconnect").onClick(async () => {
      this.plugin.settings.dropboxRefreshToken = "";
      this.plugin.settings.dropboxAccessToken = "";
      this.plugin.settings.dropboxAccessTokenExpiresAt = 0;
      this.plugin.settings.baseline = {};
      await this.plugin.saveSettings();
      this.display();
    }));
  }
  displayOneDriveSettings(containerEl) {
    containerEl.createEl("p", { text: `OneDrive Personal is accessed through Microsoft Graph. App-folder access is narrower; full-drive access requires Files.ReadWrite. ${import_obsidian2.Platform.isMobile ? "Enable public client and device code flow in your Microsoft app registration." : "Register http://localhost as a desktop redirect URI."}` });
    new import_obsidian2.Setting(containerEl).setName("Microsoft application client ID").addText((text2) => text2.setPlaceholder("Application (client) ID").setValue(this.plugin.settings.oneDriveClientId).onChange(async (value) => {
      this.plugin.settings.oneDriveClientId = value.trim();
      await this.plugin.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("Use full OneDrive access").setDesc("Sync the drive root instead of the plugin app folder. Reconnect after changing this option.").addToggle((toggle) => toggle.setValue(this.plugin.settings.oneDriveFullAccess).onChange(async (enabled) => {
      this.plugin.settings.oneDriveFullAccess = enabled;
      this.plugin.settings.oneDriveRefreshToken = "";
      this.plugin.settings.oneDriveAccessToken = "";
      this.plugin.settings.oneDriveAccessTokenExpiresAt = 0;
      this.plugin.settings.baseline = {};
      await this.plugin.saveSettings();
      this.display();
    }));
    new import_obsidian2.Setting(containerEl).setName("OneDrive account").setDesc(this.plugin.settings.oneDriveRefreshToken ? "OneDrive is connected." : import_obsidian2.Platform.isMobile ? "Microsoft displays a one-time code; approve it in your browser while Obsidian waits." : "Connect a personal OneDrive account.").addButton((button) => button.setButtonText(this.plugin.settings.oneDriveRefreshToken ? "Reconnect OneDrive" : "Connect OneDrive").onClick(async () => {
      button.setDisabled(true);
      try {
        await connectOneDrive(this.plugin.settings, this.app);
        this.plugin.settings.baseline = {};
        await this.plugin.saveSettings();
        this.plugin.addLog("OneDrive account connected.");
        new import_obsidian2.Notice("OneDrive connected.");
        this.display();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.plugin.addLog(`OneDrive connection failed: ${message}`, "ERROR");
        new import_obsidian2.Notice(`OneDrive connection failed: ${message}`);
      } finally {
        button.setDisabled(false);
      }
    })).addButton((button) => button.setButtonText("Disconnect").onClick(async () => {
      this.plugin.settings.oneDriveRefreshToken = "";
      this.plugin.settings.oneDriveAccessToken = "";
      this.plugin.settings.oneDriveAccessTokenExpiresAt = 0;
      this.plugin.settings.baseline = {};
      await this.plugin.saveSettings();
      this.display();
    }));
  }
  displayYandexDiskSettings(containerEl) {
    containerEl.createEl("p", { text: "Create a Yandex OAuth application with Yandex Disk access. Register https://oauth.yandex.ru/verification_code as its redirect URI, then authorize below and paste the resulting token." });
    new import_obsidian2.Setting(containerEl).setName("Yandex OAuth application ID").addText((text2) => text2.setPlaceholder("Application ID").setValue(this.plugin.settings.yandexDiskClientId).onChange(async (value) => {
      this.plugin.settings.yandexDiskClientId = value.trim();
      await this.plugin.saveSettings();
    }));
    containerEl.createEl("a", { text: "Open Yandex authorization", href: "#" }).addEventListener("click", (event) => {
      event.preventDefault();
      if (!this.plugin.settings.yandexDiskClientId) {
        new import_obsidian2.Notice("Enter the Yandex OAuth application ID first.");
        return;
      }
      const authUrl = `https://oauth.yandex.com/authorize?${new URLSearchParams({ response_type: "token", client_id: this.plugin.settings.yandexDiskClientId }).toString()}`;
      window.open(authUrl);
    });
    new import_obsidian2.Setting(containerEl).setName("Yandex Disk OAuth token").addText((text2) => {
      text2.inputEl.type = "password";
      text2.setPlaceholder("OAuth token").setValue(this.plugin.settings.yandexDiskToken);
      text2.onChange(async (value) => {
        this.plugin.settings.yandexDiskToken = value.trim();
        await this.plugin.saveSettings();
      });
    });
  }
  displayPCloudSettings(containerEl) {
    containerEl.createEl("p", { text: "Create a pCloud API app, grant file access, and paste its OAuth token. Select the region where your pCloud account is registered." });
    new import_obsidian2.Setting(containerEl).setName("pCloud OAuth token").addText((text2) => {
      text2.inputEl.type = "password";
      text2.setPlaceholder("OAuth token").setValue(this.plugin.settings.pcloudToken);
      text2.onChange(async (value) => {
        this.plugin.settings.pcloudToken = value.trim();
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian2.Setting(containerEl).setName("pCloud region").addDropdown((dropdown) => dropdown.addOption("us", "United States").addOption("eu", "Europe").setValue(this.plugin.settings.pcloudRegion).onChange(async (value) => {
      if (value === "us" || value === "eu") {
        this.plugin.settings.pcloudRegion = value;
        this.plugin.settings.baseline = {};
        await this.plugin.saveSettings();
      }
    }));
  }
  displayWebdisSettings(containerEl) {
    containerEl.createEl("p", { text: "Webdis stores file bytes in Redis keys. Use a private server with HTTPS and authenticated access. The configured Redis account needs SCAN, GET, SET, and DEL permissions." });
    for (const [key, name, placeholder, password] of [
      ["webdisUrl", "Webdis server URL", "https://redis-gateway.example.com/", false],
      ["webdisUsername", "Username (optional)", "Username", false],
      ["webdisPassword", "Password (optional)", "Password", true]
    ]) {
      new import_obsidian2.Setting(containerEl).setName(name).addText((text2) => {
        if (password) text2.inputEl.type = "password";
        text2.setPlaceholder(placeholder).setValue(this.plugin.settings[key]);
        text2.onChange(async (value) => {
          this.plugin.settings[key] = value.trim();
          await this.plugin.saveSettings();
        });
      });
    }
  }
  displayBoxSettings(containerEl) {
    containerEl.createEl("p", { text: "Create a Box OAuth 2.0 application with read/write access. Register the exact localhost redirect URI below in Box Developer Console. Box OAuth setup is available on desktop; connected tokens can be transferred to mobile." });
    for (const [key, name, placeholder, password] of [
      ["boxClientId", "Box client ID", "Client ID", false],
      ["boxClientSecret", "Box client secret", "Client secret", true],
      ["boxRedirectUri", "Redirect URI", "http://localhost:53682/callback", false]
    ]) {
      new import_obsidian2.Setting(containerEl).setName(name).addText((text2) => {
        if (password) text2.inputEl.type = "password";
        text2.setPlaceholder(placeholder).setValue(this.plugin.settings[key]);
        text2.onChange(async (value) => {
          this.plugin.settings[key] = value.trim();
          await this.plugin.saveSettings();
        });
      });
    }
    new import_obsidian2.Setting(containerEl).setName("Box account").setDesc(this.plugin.settings.boxRefreshToken ? "Box is connected." : "Connect your Box account.").addButton((button) => button.setButtonText(import_obsidian2.Platform.isMobile ? "Connect on desktop" : this.plugin.settings.boxRefreshToken ? "Reconnect Box" : "Connect Box").setDisabled(import_obsidian2.Platform.isMobile).onClick(async () => {
      button.setDisabled(true);
      try {
        await connectBox(this.plugin.settings);
        this.plugin.settings.baseline = {};
        await this.plugin.saveSettings();
        this.plugin.addLog("Box account connected.");
        new import_obsidian2.Notice("Box connected.");
        this.display();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.plugin.addLog(`Box connection failed: ${message}`, "ERROR");
        new import_obsidian2.Notice(`Box connection failed: ${message}`);
      } finally {
        button.setDisabled(false);
      }
    })).addButton((button) => button.setButtonText("Disconnect").onClick(async () => {
      this.plugin.settings.boxRefreshToken = "";
      this.plugin.settings.boxAccessToken = "";
      this.plugin.settings.boxAccessTokenExpiresAt = 0;
      this.plugin.settings.baseline = {};
      await this.plugin.saveSettings();
      this.display();
    }));
  }
  displayGoogleSettings(containerEl) {
    containerEl.createEl("p", {
      text: "Create a Google OAuth client and enable the Google Drive API. Enter its client ID. If Google reports that client_secret is missing, also enter the secret from the same client in Google Cloud Console. Connect opens Google's sign-in page and returns here automatically."
    });
    new import_obsidian2.Setting(containerEl).setName("Google OAuth client ID").addText(
      (text2) => text2.setPlaceholder("...apps.googleusercontent.com").setValue(this.plugin.settings.googleClientId).onChange(async (value) => {
        this.plugin.settings.googleClientId = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Google OAuth client secret (if required)").addText((text2) => {
      text2.inputEl.type = "password";
      text2.setPlaceholder("Client secret").setValue(this.plugin.settings.googleClientSecret).onChange(async (value) => {
        this.plugin.settings.googleClientSecret = value.trim();
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian2.Setting(containerEl).setName("Google account").setDesc(
      this.plugin.settings.googleRefreshToken ? "Google Drive is connected." : import_obsidian2.Platform.isMobile ? "Connect Google Drive on desktop, then securely transfer the plugin settings to this device." : "Connect an account to authorize this plugin to manage its own Drive files."
    ).addButton(
      (button) => button.setButtonText(
        import_obsidian2.Platform.isMobile ? "Connect on desktop" : this.plugin.settings.googleRefreshToken ? "Reconnect Google Drive" : "Connect Google Drive"
      ).setDisabled(import_obsidian2.Platform.isMobile).onClick(async () => {
        button.setDisabled(true);
        try {
          await connectGoogleDrive(this.plugin.settings);
          this.plugin.settings.baseline = {};
          await this.plugin.saveSettings();
          this.plugin.addLog("Google Drive account connected.");
          new import_obsidian2.Notice("Google Drive connected.");
          this.display();
        } catch (error) {
          console.error("Google Drive connection failed", error);
          const message = error instanceof Error ? error.message : String(error);
          this.plugin.addLog(`Google Drive connection failed: ${message}`, "ERROR");
          new import_obsidian2.Notice(`Google Drive connection failed: ${message}`);
        } finally {
          button.setDisabled(false);
        }
      })
    ).addButton(
      (button) => button.setButtonText("Disconnect").onClick(async () => {
        this.plugin.settings.googleRefreshToken = "";
        this.plugin.settings.googleAccessToken = "";
        this.plugin.settings.googleAccessTokenExpiresAt = 0;
        this.plugin.settings.baseline = {};
        await this.plugin.saveSettings();
        this.display();
      })
    );
  }
};
