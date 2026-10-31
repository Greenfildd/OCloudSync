# OCloudSync

OCloudSync synchronizes an Obsidian vault with WebDAV, Google Drive, S3-compatible storage, Azure Blob, Dropbox, OneDrive, Yandex Disk, pCloud, Webdis, or Box. It supports automatic, scheduled, and manual sync, configurable exclusions, conflict handling, and optional end-to-end encryption. Markdown conflicts can be merged, including with CRDT updates.

## Installation

Install OCloudSync from Obsidian's Community plugins, or copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/<configDir>/plugins/ocloudsync`. The configuration directory is usually `.obsidian`, unless it was changed in Obsidian settings. Restart Obsidian, open **Settings → Community plugins**, and enable OCloudSync.

## Setup

Open **Settings → OCloudSync**, choose a cloud provider, and enter its connection details. Connect the account when a provider offers a sign-in button, then select **Sync now**. Use the same encryption password and encryption method on every device. Exported settings contain credentials and encryption secrets, so store those files securely.

The plugin supports desktop and mobile Obsidian. Some OAuth sign-in flows require a desktop connection; those providers explain this in their connection settings. Keep a separate backup of important vault data before enabling deletion sync or changing encryption settings.



