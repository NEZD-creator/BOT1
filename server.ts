import { Telegraf } from 'telegraf';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import 'dotenv/config';

// Initialize Firebase Admin
const app = initializeApp();
const db = getFirestore(app);

// Initialize Telegraf
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');

bot.start((ctx) => ctx.reply('Welcome to the Dating Bot! Please register /register'));

bot.command('register', async (ctx) => {
  const telegramId = String(ctx.from.id);
  await db.collection('users').doc(telegramId).set({
    telegram_id: telegramId,
    name: ctx.from.first_name,
    created_at: FieldValue.serverTimestamp()
  });
  ctx.reply('You are registered! Now fill in your profile /setprofile');
});

// Start polling
bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('Bot is running...');
