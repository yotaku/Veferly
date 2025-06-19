# Save previous index.js content with webhook integration and error handling to a file

index_js_content = """
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const fetch = require('node-fetch');
const {
  Client, GatewayIntentBits, Partials, Events, REST, Routes,
  SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ChannelType
} = require('discord.js');
const { encrypt, decrypt } = require('./encrypt');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

const sendWebhook = async (content) => {
  if (!WEBHOOK_URL) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
  } catch (err) {
    console.error('❌ Webhook送信失敗:', err);
  }
};

const DATA_DIR = path.join(__dirname, 'data');
const AUTH_FILE = path.join(DATA_DIR, 'authenticated_users.json');
const GUILD_FILE = path.join(DATA_DIR, 'guild_role_settings.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const loadEncryptedArray = (file) => {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data.map(item => {
      try {
        return decrypt(item);
      } catch {
        const enc = encrypt(item);
        return decrypt(enc);
      }
    });
  } catch {
    return [];
  }
};

const saveEncryptedArray = (file, array) => {
  const encData = array.map(id => encrypt(id));
  fs.writeFileSync(file, JSON.stringify(encData, null, 2), 'utf8');
};

const loadEncryptedMap = (file) => {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const map = new Map();
    for (const [k, v] of Object.entries(data)) {
      try {
        map.set(decrypt(k), decrypt(v));
      } catch {
        const encK = encrypt(k), encV = encrypt(v);
        map.set(decrypt(encK), decrypt(encV));
      }
    }
    return map;
  } catch {
    return new Map();
  }
};

const saveEncryptedMap = (file, map) => {
  const enc = {};
  for (const [k, v] of map.entries()) {
    enc[encrypt(k)] = encrypt(v);
  }
  fs.writeFileSync(file, JSON.stringify(enc, null, 2), 'utf8');
};

const authenticatedUsers = new Set(loadEncryptedArray(AUTH_FILE));
const guildRoleSettings = loadEncryptedMap(GUILD_FILE);
const authCodes = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('認証ボタンを特定チャンネルに設置します。')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('ボタンを送信するチャンネル')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('認証成功時に付与するロール')
        .setRequired(true)
    )
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    console.log('🔁 スラッシュコマンド登録中...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ スラッシュコマンド登録完了。');
  } catch (error) {
    console.error('❌ スラッシュコマンド登録エラー:', error);
    sendWebhook(`❌ スラッシュコマンド登録エラー: \`\`\`${error.message}\`\`\``);
  }
})();

client.once(Events.ClientReady, () => {
  console.log(`✅ ログイン成功: ${client.user.tag}`);
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    if (authenticatedUsers.has(member.id)) {
      const roleId = guildRoleSettings.get(member.guild.id);
      if (roleId) {
        await member.roles.add(roleId);
        console.log(`✅ ${member.user.tag} に認証済みロールを再付与しました。`);
      }
    }
  } catch (err) {
    const errorId = `E${Date.now().toString().slice(-6)}`;
    console.error(`GuildMemberAddロール付与エラー [${errorId}]:`, err);
    sendWebhook(`❌ GuildMemberAdd ロール付与エラー [${errorId}] \n\`\`\`${err.message}\`\`\``);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.permissions.has('Administrator')) {
        return interaction.reply({ content: '🚫 管理者権限が必要です。', ephemeral: true });
      }

      const channel = interaction.options.getChannel('channel');
      const role = interaction.options.getRole('role');
      const roleId = role.id;
      const guildId = interaction.guild.id;

      guildRoleSettings.set(guildId, roleId);
      saveEncryptedMap(GUILD_FILE, guildRoleSettings);

      sendWebhook(`🛠️ 新しいサーバーで/setupが実行されました\nGuild ID: \`${guildId}\`\nRole ID: \`${roleId}\``);

      const button = new ButtonBuilder()
        .setCustomId('verify_button')
        .setLabel('認証する')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(button);

      await channel.send({
        content: `📌 以下のボタンをクリックして認証を開始してください。\n（コミュニティ参加には認証が必要です）`,
        components: [row]
      });

      return interaction.reply({ content: `✅ 認証ボタンを <#${channel.id}> に設置しました。`, ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'verify_button') {
      const userId = interaction.user.id;
      const guildId = interaction.guild.id;
      const roleId = guildRoleSettings.get(guildId);
      const member = await interaction.guild.members.fetch(userId);

      if (authenticatedUsers.has(userId)) {
        if (roleId && !member.roles.cache.has(roleId)) {
          await member.roles.add(roleId);
          return interaction.reply({ content: '✅ 認証済みです。ロールを再付与しました。', ephemeral: true });
        } else {
          return interaction.reply({ content: '✅ あなたは既に認証済みです。', ephemeral: true });
        }
      }

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      authCodes.set(userId, { code, guildId });

      try {
        await interaction.user.send(`✅ 認証コード: **${code}** をこのDMに返信してください。`);
        return interaction.reply({ content: '📩 DMに認証コードを送信しました。', ephemeral: true });
      } catch (err) {
        console.error('DM送信失敗:', err);
        return interaction.reply({ content: '⚠️ DMを送信できませんでした。DMを有効にしてください。', ephemeral: true });
      }
    }
  } catch (err) {
    const errorId = `E${Date.now().toString().slice(-6)}`;
    console.error(`Interactionエラー [${errorId}]:`, err);
    sendWebhook(`❌ Interactionエラー [${errorId}] \n\`\`\`${err.message}\`\`\``);
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.channel.type !== 1 || message.author.bot) return;

    const record = authCodes.get(message.author.id);
    if (!record) return;

    const { code } = record;

    if (message.content.includes(code)) {
      authenticatedUsers.add(message.author.id);
      saveEncryptedArray(AUTH_FILE, Array.from(authenticatedUsers));

      for (const [guildId, roleId] of guildRoleSettings.entries()) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;

        const member = await guild.members.fetch(message.author.id).catch(() => null);
        if (member) {
          await member.roles.add(roleId).catch(err => {
            const errorId = `E${Date.now().toString().slice(-6)}`;
            console.error(`ロール付与失敗 [${errorId}] (${guild.name}):`, err);
            sendWebhook(`❌ ロール付与失敗 [${errorId}] (${guild.name})\nUser: <@${message.author.id}>\n\`\`\`${err.message}\`\`\``);
            message.reply(`⚠️ エラーが発生しました（エラーコード: \`${errorId}\`）。管理者にお問い合わせください。`);
          });
        }
      }

      authCodes.delete(message.author.id);
      await message.reply('✅ 認証に成功しました！ロールを付与しました。');
      await sendWebhook(`✅ ユーザー <@${message.author.id}> が認証に成功しました。`);
    } else {
      await message.reply('❌ 認証コードが一致しません。');
    }
  } catch (err) {
    const errorId = `E${Date.now().toString().slice(-6)}`;
    console.error(`DM認証エラー [${errorId}]:`, err);
    sendWebhook(`❌ DM認証エラー [${errorId}]\n\`\`\`${err.message}\`\`\``);
    message.reply(`⚠️ エラーが発生しました（エラーコード: \`${errorId}\`）。管理者にお問い合わせください。`);
  }
});

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

app.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});
"""

# Save to file
file_path = "/mnt/data/index.js"
with open(file_path, "w", encoding="utf-8") as f:
    f.write(index_js_content)

file_path
