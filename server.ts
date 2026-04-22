import { Telegraf, session, Scenes, Markup } from 'telegraf';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, query, where, limit, serverTimestamp } from 'firebase/firestore';
import express from 'express';
import * as fs from 'fs';
import 'dotenv/config';

// Load Client config securely
const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf-8'));

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("  CRITICAL ERROR: TELEGRAM_BOT_TOKEN IS MISSING!  ");
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const expressApp = express();
const PORT = 3000;
expressApp.get('/', (req, res) => res.send(`Bot is Active`));
expressApp.listen(PORT, '0.0.0.0', () => console.log(`HTTP server on port ${PORT}`));

const bot = token ? new Telegraf(token) : null;

if (bot) {
    const { WizardScene, Stage } = Scenes;

    // Helper to gracefully delete messages
    const del = async (ctx: any, msgId: number | undefined) => {
        if (!msgId) return;
        try { await ctx.deleteMessage(msgId); } catch (e) { /* ignore if already deleted */ }
    };

    const profileWizard = new WizardScene(
      'profile-wizard',
      async (ctx: any) => {
        ctx.wizard.state.p = {};
        const msg = await ctx.reply('Твой пол?', Markup.inlineKeyboard([
          [Markup.button.callback('🙎‍♂️ Парень', 'gender_m'), Markup.button.callback('🙎‍♀️ Девушка', 'gender_f')]
        ]));
        ctx.wizard.state.lastBotMsg = msg.message_id;
        return ctx.wizard.next();
      },
      async (ctx: any) => {
        if (!ctx.callbackQuery) return;
        const data = ctx.callbackQuery.data;
        if (!['gender_m', 'gender_f'].includes(data)) return;
        
        ctx.wizard.state.p.gender = data;
        await del(ctx, ctx.callbackQuery.message.message_id);
        
        const msg = await ctx.reply('Кто тебя интересует?', Markup.inlineKeyboard([
            [Markup.button.callback('🙎‍♂️ Парни', 'target_m'), Markup.button.callback('🙎‍♀️ Девушки', 'target_f')],
            [Markup.button.callback('👫 Все', 'target_any')]
        ]));
        ctx.wizard.state.lastBotMsg = msg.message_id;
        return ctx.wizard.next();
      },
      async (ctx: any) => {
        if (!ctx.callbackQuery) return;
        const data = ctx.callbackQuery.data;
        if (!['target_m', 'target_f', 'target_any'].includes(data)) return;
        
        ctx.wizard.state.p.target_gender = data;
        await del(ctx, ctx.callbackQuery.message.message_id);
        
        const msg = await ctx.reply('Твое имя?');
        ctx.wizard.state.lastBotMsg = msg.message_id;
        return ctx.wizard.next();
      },
      async (ctx: any) => {
        if (!ctx.message || !('text' in ctx.message)) return;
        ctx.wizard.state.p.name = ctx.message.text.substring(0, 50);
        await del(ctx, ctx.message.message_id);
        await del(ctx, ctx.wizard.state.lastBotMsg);
        
        const msg = await ctx.reply('Сколько лет? (цифрой)');
        ctx.wizard.state.lastBotMsg = msg.message_id;
        return ctx.wizard.next();
      },
      async (ctx: any) => {
        if (!ctx.message || !('text' in ctx.message)) return;
        const age = parseInt(ctx.message.text);
        if (isNaN(age) || age < 14 || age > 99) {
            const m = await ctx.reply('Введи настоящий возраст числом.');
            await del(ctx, ctx.message.message_id);
            ctx.wizard.state.lastBotMsg = m.message_id; // temporarily store error msg
            return;
        }
        
        ctx.wizard.state.p.age = age;
        await del(ctx, ctx.message.message_id);
        await del(ctx, ctx.wizard.state.lastBotMsg);
        
        const msg = await ctx.reply('Твой город?');
        ctx.wizard.state.lastBotMsg = msg.message_id;
        return ctx.wizard.next();
      },
      async (ctx: any) => {
        if (!ctx.message || !('text' in ctx.message)) return;
        
        ctx.wizard.state.p.city = ctx.message.text.substring(0, 50);
        await del(ctx, ctx.message.message_id);
        await del(ctx, ctx.wizard.state.lastBotMsg);
        
        const msg = await ctx.reply('Расскажи о себе (описание):');
        ctx.wizard.state.lastBotMsg = msg.message_id;
        return ctx.wizard.next();
      },
      async (ctx: any) => {
        if (!ctx.message || !('text' in ctx.message)) return;
        
        ctx.wizard.state.p.bio = ctx.message.text.substring(0, 300);
        await del(ctx, ctx.message.message_id);
        await del(ctx, ctx.wizard.state.lastBotMsg);
        
        const msg = await ctx.reply('Пришли свое фото 📸');
        ctx.wizard.state.lastBotMsg = msg.message_id;
        return ctx.wizard.next();
      },
      async (ctx: any) => {
        if (!ctx.message || !('photo' in ctx.message)) return;
        
        const photos = (ctx.message as any).photo;
        ctx.wizard.state.p.photo_url = photos[photos.length - 1].file_id;
        
        await del(ctx, ctx.message.message_id);
        await del(ctx, ctx.wizard.state.lastBotMsg);
        
        const telegramId = String(ctx.from.id);
        const username = ctx.from.username || '';
        const p = ctx.wizard.state.p;
        
        const profileData = {
            telegram_id: telegramId,
            username: username,
            name: p.name,
            gender: p.gender,
            target_gender: p.target_gender,
            age: p.age,
            city: p.city,
            bio: p.bio,
            photo_url: p.photo_url,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            active: true
        };
        
        try {
            await setDoc(doc(db, 'users', telegramId), profileData);
            const caption = `${p.name}, ${p.age}, ${p.city}\n${p.bio}`;
            await ctx.replyWithPhoto(p.photo_url, { 
                caption: caption,
                reply_markup: {
                    inline_keyboard: [[{ text: '🚀 Смотреть анкеты', callback_data: 'start_search' }]]
                }
            });
        } catch (err: any) {
            console.error("Profile save error:", err);
            await ctx.reply(`Ошибка при сохранении: ${err.message}`);
        }
        return ctx.scene.leave();
      }
    );

    const stage = new Stage([profileWizard]);
    
    bot.catch((err, ctx) => console.error(`Error for ${ctx.updateType}`, err));
    bot.use(session());
    bot.use(stage.middleware() as any);

    bot.start((ctx) => ctx.reply('Привет! Давай создадим профиль: /profile'));
    bot.command('profile', (ctx: any) => ctx.scene.enter('profile-wizard'));
    bot.action('start_search', async (ctx) => {
        await ctx.answerCbQuery();
        await showNextProfile(ctx, String(ctx.from?.id));
    });

    async function showNextProfile(ctx: any, telegramId: string) {
        try {
            const userDoc = await getDoc(doc(db, 'users', telegramId));
            if (!userDoc.exists()) return ctx.reply('Сначала создай профиль: /profile');
            const myProfile = userDoc.data()!;
            
            // Get interacted profiles
            const intQuery = query(collection(db, 'interactions'), where('from_user_id', '==', telegramId));
            const interactions = await getDocs(intQuery);
            const interactedIds = new Set(interactions.docs.map(d => d.data().to_user_id));
            interactedIds.add(telegramId);
            
            // Basic query for target gender
            let usersQuery: any = undefined;
            if (myProfile.target_gender === 'target_m') {
                usersQuery = query(collection(db, 'users'), where('active', '==', true), where('gender', '==', 'gender_m'), limit(50));
            } else if (myProfile.target_gender === 'target_f') {
                usersQuery = query(collection(db, 'users'), where('active', '==', true), where('gender', '==', 'gender_f'), limit(50));
            } else {
                usersQuery = query(collection(db, 'users'), where('active', '==', true), limit(50));
            }
            
            const candidates = await getDocs(usersQuery);
            
            let candidateToShow = null;
            for (const cDoc of candidates.docs) {
                if (interactedIds.has(cDoc.id)) continue;
                const b = cDoc.data();
                
                // Two way match logic
                if (b.target_gender !== 'target_any') {
                    const expectedAGender = b.target_gender === 'target_m' ? 'gender_m' : 'gender_f';
                    if (myProfile.gender !== expectedAGender) continue;
                }
                
                candidateToShow = b;
                break;
            }
            
            if (!candidateToShow) {
                return ctx.reply('Анкеты закончились! Возвращайся позже. 💤');
            }
            
            const caption = `${candidateToShow.name}, ${candidateToShow.age}, г. ${candidateToShow.city}\n\n${candidateToShow.bio}`;
            
            await ctx.replyWithPhoto(candidateToShow.photo_url, {
                caption,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '👎', callback_data: `dislike_${candidateToShow.telegram_id}` },
                            { text: '❤️', callback_data: `like_${candidateToShow.telegram_id}` }
                        ]
                    ]
                }
            });
        } catch (err) {
            console.error("Search error:", err);
            ctx.reply('Ошибка поиска. Попробуй /search');
        }
    }

    bot.command('search', async (ctx) => {
        await showNextProfile(ctx, String(ctx.from.id));
    });

    bot.action(/^like_(.+)$/, async (ctx) => {
        const toUserId = ctx.match[1];
        const fromUserId = String(ctx.from?.id);
        
        try {
            await setDoc(doc(db, 'interactions', `${fromUserId}_${toUserId}`), {
                from_user_id: fromUserId,
                to_user_id: toUserId,
                type: 'like',
                created_at: serverTimestamp()
            });
            
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});
            
            // Check for match
            const matchDocResult = await getDoc(doc(db, 'interactions', `${toUserId}_${fromUserId}`));
                
            if (matchDocResult.exists() && matchDocResult.data()?.type === 'like') {
                const myDocResult = await getDoc(doc(db, 'users', fromUserId));
                const otherDocResult = await getDoc(doc(db, 'users', toUserId));
                const myData = myDocResult.data()!;
                const otherData = otherDocResult.data()!;
                
                const myUrl = myData.username ? `https://t.me/${myData.username}` : `tg://user?id=${fromUserId}`;
                const otherUrl = otherData.username ? `https://t.me/${otherData.username}` : `tg://user?id=${toUserId}`;
                
                ctx.answerCbQuery('Есть совпадение! ❤️', { showAlert: true });
                
                // Notify Me
                await ctx.replyWithPhoto(otherData.photo_url, {
                    caption: `Взаимная симпатия! ❤️\nТебе понравился(ась) ${otherData.name}\n\nНачинай общаться!`,
                    reply_markup: { inline_keyboard: [[{ text: `💬 Написать ${otherData.name}`, url: otherUrl }]] }
                });
                
                // Notify Other
                await bot.telegram.sendPhoto(toUserId, myData.photo_url, {
                    caption: `Взаимная симпатия! ❤️\nКому-то понравилась твоя анкета (${myData.name})!`,
                    reply_markup: { inline_keyboard: [[{ text: `💬 Написать ${myData.name}`, url: myUrl }]] }
                });
            } else {
                ctx.answerCbQuery('Лайк отправлен');
            }
            
            await showNextProfile(ctx, fromUserId);
        } catch (err) {
            console.error("Like error:", err);
            ctx.answerCbQuery('Произошла ошибка');
        }
    });

    bot.action(/^dislike_(.+)$/, async (ctx) => {
        const toUserId = ctx.match[1];
        const fromUserId = String(ctx.from?.id);
        
        try {
            await setDoc(doc(db, 'interactions', `${fromUserId}_${toUserId}`), {
                from_user_id: fromUserId,
                to_user_id: toUserId,
                type: 'dislike',
                created_at: serverTimestamp()
            });
            
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});
            ctx.answerCbQuery('Пропущено');
            await showNextProfile(ctx, fromUserId);
        } catch (err) {
             console.error("Dislike error:", err);
             ctx.answerCbQuery('Ошибка');
        }
    });

    bot.launch();
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
    console.log('Bot is running...');
}