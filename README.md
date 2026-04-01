# QuestHelper - Discord Quest Auto-Completer

A Vencord plugin that automatically accepts and completes Discord quests.

## Features

- **Auto-Accept Quests** - Automatically enroll in newly available quests
- **Auto-Complete Quests** - Handles multiple quest types:
  - Watch Video quests (speed up video progress)
  - Play On Desktop quests (spoof game running)
  - Stream On Desktop quests (spoof streaming)
  - Play Activity quests (send heartbeats)
- **Background Processing** - Runs automatically in the background
- **Rate Limit Handling** - Respects Discord's rate limits with retries
- **Session Management** - Reinitializes on connection/accounts changes

## Things not implemented

- **Multiple quest completion** - Only one quest can be completed at a time.

This is intentional. Discord's system monitors the timing between different activities, so if actions are completed unrealistically fast, it can flag your account and potentially ban you for self-botting.

This does not say that they track the time during your quests. This is saying that it takes the time between your quests.

There's also evidence that for accounts under 18, Discord tracks time spent on quests more strictly. After completing around three quests, a cooldown of 24-48 hours can be applied before you're allowed to continue.

Don't go into issues and file this, you fucking retards.

## Installation
#### Installing Vencord
1. `git clone https://github.com/Vendicated/Vencord/`
2. `cd Vencord`

#### Installing the plugin
3. `cd src`
4. `mkdir userplugins`
5. `git clone https://github.com/itzinject/QuestHelper`
6. `cd ../` (back to vencord)

#### Building Vencord
8. `pnpm install`
9. `pnpm build`
10. `pnpm inject` into stable (Becouse you guys are stable... right?)

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `autoAcceptQuests` | Automatically accept available quests | `false` |
| `logProgress` | Log quest progress to console | `true` |

## How It Works

The plugin:
1. Detects when Discord connects or quest status updates
2. Auto-accepts any available quests (if enabled)
3. Queues enrolled quests for completion
4. For each quest type, spoofs the required activity:
   - **Video quests**: Sends fake video progress timestamps
   - **Game quests**: Spoofs RunningGameStore to appear as playing
   - **Stream quests**: Spoofs streaming metadata
   - **Activity quests**: Sends heartbeat requests

## Requirements

- Vencord plugin loader
- Discord desktop app
- Windows (some features require desktop app)
- Some fucking knowledge of powershell

## Disclaimer

This plugin is for educational purposes. Automating quests may violate Discord's Terms of Service. Use at your own risk. I am not responsible for any harm done to your account.

## License

GPL-3.0-or-later

## Credits

Based on [Vencord](https://github.com/Vendicated/Vencord) plugin system.
