require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, Events, REST, Routes,
  SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ChannelType
} = require('discord.js');

const {
  Client, GatewayIntentBits, Partials, Events, REST, Routes,
  SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ChannelType
} = require('discord.js');

const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('✅ Bot is running!'));
app.listen(3000, () => console.log('🌐 Web server running on port 3000'));

// ✅ .env から読み込む
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;


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

// --- データ保持用 ---
const authCodes = new Map();             // userId => { code, guildId }
const authenticatedUsers = new Set();    // 認証済み userId
const guildRoleSettings = new Map();     // guildId => roleId

// --- コマンド定義 ---
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

// --- スラッシュコマンド登録 ---
(async () => {
  try {
    console.log('🔁 スラッシュコマンド登録中...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ スラッシュコマンド登録完了。');
  } catch (error) {
    console.error('❌ スラッシュコマンド登録エラー:', error);
  }
})();

client.once(Events.ClientReady, () => {
  console.log(`✅ ログイン成功: ${client.user.tag}`);
});

// --- インタラクション処理 ---
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.permissions.has('Administrator')) {
        return interaction.reply({ content: '🚫 このコマンドは管理者専用です。', ephemeral: true });
      }

      const channel = interaction.options.getChannel('channel');
      const role = interaction.options.getRole('role');
      const roleId = role.id;
      const guildId = interaction.guild.id;

      // 設定保存
      guildRoleSettings.set(guildId, roleId);

      // 既存メッセージ削除
      try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const deletableMessages = messages.filter(m => m.deletable);
        await channel.bulkDelete(deletableMessages);
      } catch (err) {
        console.error('メッセージ削除エラー:', err);
        return interaction.reply({ content: '⚠️ メッセージの削除に失敗しました。Botに必要な権限があるか確認してください。', ephemeral: true });
      }

      const button = new ButtonBuilder()
        .setCustomId('verify_button')
        .setLabel('認証する')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(button);

      await channel.send({
        content: `📌 以下のボタンをクリックして認証を開始してください。\n（コミュニティ参加には認証が必要です）`,
        components: [row]
      });

      await interaction.reply({ content: `✅ 認証ボタンを <#${channel.id}> に設置しました。`, ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'verify_button') {
      if (authenticatedUsers.has(interaction.user.id)) {
        return interaction.reply({ content: '✅ あなたは既に認証済みです。', ephemeral: true });
      }

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      authCodes.set(interaction.user.id, { code, guildId: interaction.guild.id });

      try {
        await interaction.user.send(`✅ 認証コード: **${code}** をこのDMに返信してください。`);
        await interaction.reply({ content: '📩 DMに認証コードを送信しました。', ephemeral: true });
      } catch (err) {
        console.error('DM送信失敗:', err);
        await interaction.reply({ content: '⚠️ DMを送信できませんでした。DMを有効にしてください。', ephemeral: true });
      }
    }
  } catch (err) {
    console.error('Interactionエラー:', err);
  }
});

// --- DMでの認証コード処理 ---
client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.channel.type !== 1 || message.author.bot) return;

    const record = authCodes.get(message.author.id);
    if (!record) return;

    const { code } = record;

    if (message.content.includes(code)) {
      authenticatedUsers.add(message.author.id);

      for (const [guildId, guild] of client.guilds.cache) {
        const roleId = guildRoleSettings.get(guildId);
        if (!roleId) continue;

        try {
          const member = await guild.members.fetch(message.author.id).catch(() => null);
          if (member) {
            await member.roles.add(roleId).catch(console.error);
          }
        } catch (e) {
          console.error(`ロール付与失敗 @ ${guild.name}:`, e);
        }
      }

      authCodes.delete(message.author.id);
      await message.reply('✅ 認証に成功しました！全参加サーバーでロールを付与しました。');
    } else {
      await message.reply('❌ 認証コードが一致しません。');
    }
  } catch (err) {
    console.error('DM認証エラー:', err);
  }
});

client.login(TOKEN);
