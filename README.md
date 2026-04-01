# QuestHelper - Discord Quest Auto-Completer

A Vencord plugin that automatically accepts and completes Discord quests.

## Features

- **Auto-Accept Quests** - Automatically enroll in newly available quests
- **Auto-Complete Quests** - Handles multiple quest types:
  - Watch Video quests (speed up video progress)
  - Play On Desktop quests (spoof game running)
  - Stream On Desktop quests (spoof streaming)
  - Play Activity quests (send heartbeats)
- **Flexible Logging** - Log to console, a Discord webhook, or both
- **Background Processing** - Runs automatically in the background
- **Rate Limit Handling** - Respects Discord's rate limits with retries
- **Session Management** - Reinitializes on connection/account changes

## Things not implemented

- **Multiple quest completion** - Only one quest can be completed at a time.

This is intentional. Discord's system monitors the timing between different activities, so if actions are completed unrealistically fast, it can flag your account and potentially ban you for self-botting.

This does not say that they track the time *during* your quests. This is saying that it tracks the time *between* your quests.

There's also evidence that for accounts under 18, Discord tracks time spent on quests more strictly. After completing around three quests, a cooldown of 24-48 hours can be applied before you're allowed to continue.

Don't go into issues and file this you fucking retards.

## Requirements

- **Git** - to clone Vencord and the plugin
- **Node.js** (v18 or later) - required by Vencord's build toolchain
- **pnpm** - Vencord's package manager (`npm install -g pnpm`)
- **Discord desktop app** - required for game/stream spoofing quests
- **Windows** - some quest types (PLAY_ON_DESKTOP, STREAM_ON_DESKTOP) require the desktop app
- Some knowledge of PowerShell or a terminal

## Installation

#### Installing Vencord
```sh
git clone https://github.com/Vendicated/Vencord/
cd Vencord
```

#### Installing the plugin
```sh
cd src
mkdir userplugins
git clone https://github.com/itzinject/QuestHelper
cd ../
```

#### Building Vencord
```sh
pnpm install
pnpm build
pnpm inject
```

Inject into **stable** (because you guys are stable... right?)

## Settings

| Setting | Description | Default |
|--|--|--|
| `autoAcceptQuests` | Automatically accept available quests | `false` |
| `logDestination` | Where to send log messages: `Console`, `Webhook`, or `Both` | `Console` |
| `webhookUrl` | Discord webhook URL. Used when log destination is `Webhook` or `Both` | *(empty)* |

### Setting up a webhook

1. Open any Discord channel you own → **Edit Channel** → **Integrations** → **Webhooks**
2. Click **New Webhook**, give it a name (e.g. `QuestHelper`), copy the URL
3. Paste it into the `webhookUrl` setting in the plugin

Logs are batched and sent every 2 seconds to avoid rate limits, and arrive formatted as code blocks.

## How It Works

The plugin:

1. Detects when Discord connects or quest status updates
2. Auto-accepts any available quests (if enabled)
3. Queues enrolled quests for completion
4. For each quest type, spoofs the required activity:
   - **Video quests**: Sends fake video progress timestamps
   - **Game quests**: Spoofs `RunningGameStore` to appear as playing
   - **Stream quests**: Spoofs streaming metadata
   - **Activity quests**: Sends heartbeat requests

## Disclaimer

This plugin is for educational purposes. Automatiion of these quests may violate Discord's Terms of Service. Use at your own risk. I am not responsible for any harm done to your account.

## Credits

Based on the [Vencord](https://github.com/Vendicated/Vencord) plugin system.
