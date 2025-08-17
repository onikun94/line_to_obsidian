# LINE Notes Sync

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.3.3-blue.svg)](https://github.com/onikun94/obsidian-to-note/releases)
[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-7c3aed.svg)](https://obsidian.md)

A plugin that connects Obsidian with LINE. Messages sent from LINE are automatically saved as Obsidian notes.

## Features

- **Automatic sync**: Save LINE messages as Obsidian notes automatically
- **Message encryption**: Messages are encrypted before transmission
- **Flexible organization**: Organize notes by date with customizable folder structure
- **Custom file naming**: Use templates with variables like {date}, {time}, {messageId}
- **Duplicate prevention**: Automatically handle duplicate messages
- **Manual and auto-sync**: Sync on-demand or automatically at intervals
- **Multi-vault support**: Connect multiple Obsidian vaults with unique Vault IDs
- **Text support**: Currently supports text messages only

## Important Security and Privacy Notice

**This plugin encrypts messages for secure transmission between LINE and Obsidian.**

- Messages are encrypted before being sent to the server
- Messages are stored in encrypted form on the Cloudflare server temporarily
- The server cannot decrypt or read your message contents
- Messages are automatically deleted from the server after 10 days
- The server operates in the Japan region and only processes and forwards encrypted messages
- While encryption provides security, we recommend avoiding extremely sensitive information

## Setup Instructions

### 1. Install Obsidian Plugin

1. Open Obsidian settings
2. Third-party plugins → Community plugins → Browse
3. Search for "LINE Notes Sync"
4. Install "LINE Notes Sync"
5. Enable the plugin

### 2. LINE Setup

1. Add [LINE Official Account](https://lin.ee/fq051VM) as a friend
2. Send any message (e.g., `test`)
3. After sending a message, you will receive your LINE User ID
4. Enter the returned LINE User ID in the Obsidian plugin settings

### 3. Plugin Configuration

1. Open plugin settings
2. Configure basic settings:
   - **Destination folder**: Set where to save notes (default: "LINE")
   - **Organize by date**: Enable to create daily subfolders
   - **File name template**: Customize using variables like {date}, {time}, {messageId}
3. Configure sync settings:
   - **Auto-sync**: Enable automatic synchronization
   - **Sync interval**: Set between 1-5 hours
   - **Sync on startup**: Enable to sync when Obsidian starts
4. Set up connection:
   - **Vault ID**: Create a unique identifier (e.g., "my-vault-123")
     - This ID identifies your Obsidian vault for message routing
     - Use any memorable string
   - **LINE User ID**: Enter the ID obtained from LINE setup
5. Press the **Register** button to establish the encrypted connection

## How to Sync

### Manual Sync
1. Click the sync icon in the plugin ribbon
2. Or run "Sync LINE messages" from the command palette

### Automatic Sync
- Enable auto-sync in settings to sync messages automatically
- Configure sync interval (1-5 hours)
- Enable sync on startup for immediate updates when opening Obsidian

## File Naming Variables

You can customize file names using these variables:
- `{date}` - Date with hyphens (2024-01-15)
- `{datecompact}` - Date without hyphens (20240115)
- `{time}` - Time only (14:30:45)
- `{datetime}` - Full datetime (20240115143045)
- `{messageId}` - Unique message identifier
- `{userId}` - LINE user ID
- `{timestamp}` - Unix timestamp

Example: `{date}_{time}_LINE` → `2024-01-15_14-30-45_LINE.md`

## Limitations

- **Desktop only**: This plugin is not available on Obsidian mobile
- **Text messages only**: Images, videos, and other media types are not yet supported
- **One-way sync**: Messages flow from LINE to Obsidian only
- **Message expiration**: Messages are deleted from the server after 10 days

## Support

If you encounter any issues, please report them on [GitHub Issues](https://github.com/onikun94/line_to_obsidian/issues).

## License

MIT
