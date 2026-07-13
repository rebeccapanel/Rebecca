---
title: "Telegram backup activation"
weight: 2
description: "Set up automatic panel backups by creating a Telegram bot, adding it to a private group, and enabling Backup from the panel."
adminOnly: true
---

<span id="section-telegram-backup"></span>

Set up automatic panel backups by creating a Telegram bot, adding it to a private group, and enabling Backup from the panel.

## Steps

1. Create a Telegram bot with BotFather and keep the token private.
2. Create a private Telegram group for backup messages and add the bot to it.
3. Activate the bot in the panel first, then enable the Backup option.
4. Run a manual backup test once so you know the group receives files correctly.

{{< callout type="info" >}}
**Good to know**

- Use a private group with only trusted admins.
- Never send the bot token to users or public chats.
- If the panel has a Telegram test button, use it before turning on scheduled backups.
{{< /callout >}}

## Create the bot with BotFather {#section-telegram-backup-botfather}

BotFather is Telegram's official tool for creating and managing bots.

1. Open Telegram and search for @BotFather.
2. Start the chat and send /newbot.
3. Enter a display name for the bot, such as Rebecca Backup.
4. Enter a unique username that ends with bot, for example rebecca_backup_bot.
5. Copy the token BotFather gives you and store it somewhere private.

{{< callout type="info" >}}
**Good to know**

- The token is the bot password. Anyone who has it can control the bot.
{{< /callout >}}

## Create the backup group {#section-telegram-backup-group}

1. In Telegram, create a new group and give it a clear name like Panel Backups.
2. Open the group settings and enable Forum; the backup group must be forum-enabled.
3. Add your new bot to the group.
4. Promote the bot to admin if the panel needs permission to send files or messages.
5. Send one normal message in the group before testing the panel connection.

{{< callout type="info" >}}
**Good to know**

- Keep the group private so backup files stay protected.
- If the panel asks for a chat or group ID, use the panel's Telegram test/detect flow if available.
{{< /callout >}}

## Enable Backup in the panel {#section-telegram-backup-panel}

1. Open the panel's Telegram/Bot settings and activate the bot with the BotFather token.
2. Confirm the bot can send a test message to the backup group.
3. Go to Master settings -> Telegram -> <a href="#" data-panel-route="/integrations?focus=periodic-backup#telegram">Periodic Backup</a> and enable Telegram backup.
4. Save the settings, then run one manual backup to verify the QR/files arrive in the group.
5. After the test succeeds, leave scheduled backup enabled.

{{< callout type="info" >}}
**Good to know**

- Activate the bot first; the Backup option should be enabled only after the bot connection is working.
- If nothing arrives, check bot admin permissions, the group ID, and whether the token was copied correctly.
{{< /callout >}}
