# LINE Notes Sync

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.7.0-blue.svg)](https://github.com/onikun94/obsidian-to-note/releases)
[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-7c3aed.svg)](https://obsidian.md)

A plugin that connects Obsidian with LINE. Messages sent from LINE are automatically saved as Obsidian notes.

## Features

- **Automatic sync**: Save LINE messages as Obsidian notes automatically
- **Text messages**: Unlimited sync on both the Free and Premium plans
- **Image sync**: Photos sent from LINE are saved to your vault (Free: up to 10 images total, Premium: unlimited)
- **Voice transcription**: Voice messages sent from LINE are transcribed to text via Cloudflare Workers AI (Whisper) and synced as notes (Free: up to 10 transcriptions total, Premium: unlimited)
- **End-to-end encryption**: Text and images are encrypted so the server cannot read them; see [Important Security and Privacy Notice](#important-security-and-privacy-notice) for how voice transcription differs
- **LINE bot commands**: Check your LINE User ID, plan, and remaining quota, or upgrade — directly from the LINE chat (see [LINE Bot Commands](#line-bot-commands))
- **Flexible organization**: Organize notes by date with customizable folder structure
- **Custom file naming**: Use templates with variables like {date}, {time}, {messageId}
- **Duplicate prevention**: Automatically handle duplicate messages
- **Manual and auto-sync**: Sync on-demand or automatically at intervals
- **Multi-vault support**: Connect multiple Obsidian vaults with unique Vault IDs

## Pricing

| | Free | Premium |
|---|---|---|
| Price | ¥0 | ¥300/month (tax included) |
| Text sync | Unlimited | Unlimited |
| Image sync | Up to 10 images total | Unlimited |
| Voice transcription | Up to 10 transcriptions total | Unlimited |

- Upgrade by sending `/upgrade` (or "アップグレード") to the LINE bot — it replies with a Stripe Checkout link directly in the chat
- Manage billing or cancel anytime via the Stripe Customer Portal at [line-notes-sync.pages.dev](https://line-notes-sync.pages.dev)
- You'll receive a LINE notification when a payment succeeds, fails, or your subscription is canceled

## LINE Bot Commands

Send these commands directly to the LINE Official Account:

- `/myid` - Show your LINE User ID (needed when connecting the plugin)
- `/status` - Check your current plan and remaining free quota for images and voice transcription
- `/upgrade` or "アップグレード" - Get a Stripe Checkout link to subscribe to Premium

You usually don't need to type these: the bot's replies come with tappable buttons (使い方 / プラン確認 / プレミアム登録) above the input field.

## Important Security and Privacy Notice

**Text messages and images are end-to-end encrypted. Voice transcription is not, because the server has to process the audio to transcribe it.**

- Text messages and images are encrypted before being sent to the server
- Encrypted text and images are stored temporarily on the Cloudflare server; the server cannot decrypt or read their contents
- **Voice messages are handled differently.** Transcribing audio requires it to be processed on the server: voice messages are sent to Cloudflare Workers AI (Whisper) for transcription. The audio file itself is never stored on the server and is discarded once transcription completes. The resulting transcribed text is then stored using the same end-to-end encryption as regular text messages
- Text messages (including transcribed voice text) are automatically deleted from the server after 10 days
- Images are deleted from the server as soon as they finish syncing to Obsidian; images that are never synced expire automatically after 7 days. Maximum image size is 10MB
- The server operates in the Japan region
- While encryption provides security, we recommend avoiding extremely sensitive information, especially in voice messages

## Setup Instructions

### 1. Install Obsidian Plugin

Requires Obsidian 1.4.0 or later. Settings search is supported on Obsidian 1.13.0 or later.

1. Open Obsidian settings
2. Third-party plugins → Community plugins → Browse
3. Search for "LINE Notes Sync"
4. Install "LINE Notes Sync"
5. Enable the plugin

### 2. LINE Setup

1. Add [LINE Official Account](https://lin.ee/fq051VM) as a friend
2. Send `/myid` (or any message)
3. The bot replies with your LINE User ID
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
- **One-way sync**: Messages flow from LINE to Obsidian only
- **Message expiration**: Text messages (and transcribed voice text) are deleted from the server after 10 days; images expire after 7 days if never synced

## Support

If you encounter any issues, please report them on [GitHub Issues](https://github.com/onikun94/line_to_obsidian/issues).

You can support development through [Buy Me a Coffee](https://buymeacoffee.com/shotovim).
Contributions are optional and do not include a Premium subscription.

## License

MIT
