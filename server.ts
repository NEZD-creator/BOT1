import { Telegraf, session, Scenes, Markup } from 'telegraf';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, query, where, limit, serverTimestamp } from 'firebase/firestore';
import express from 'express';
import * as fs from 'fs';
import 'dotenv/config';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf-8'));
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) console.error("CRITICAL ERROR: TELEGRAM_BOT_TOKEN IS MISSING!");

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const expressApp = express();
expressApp.get('/', (req, res) => res.send(`Bot is Active`));
expressApp.listen(3000, '0.0.0.0', () => console.log('HTTP Server running.'));

const bot = token ? new Telegraf(token) : null;

if (bot) {
    const { WizardScene, Stage } = Scenes;

    const del = async (ctx: any, msgId: number | undefined) => {
        if (!msgId) return;
        try { await ctx.deleteMessage(msgId); } catch (e) {}
    };

    const sendMedia = async (ctx: any, d: any, caption: string, reply_markup: any) => {
        const type = d.media_type || 'photo';
        const id = d.media_id || d.photo_url;
        const opts = { caption, reply_markup, parse_mode: 'HTML' };
        
        if (type === 'video') return ctx.replyWithVideo(id, opts);
        if (type === 'animation') return ctx.replyWithAnimation(id, opts);
        return ctx.replyWithPhoto(id, opts);
    };

    const mainMenu = Markup.keyboard([
        ['🔥 Смотреть анкеты', '👤 Моя анкета']
    ]).resize();

    const profileWizard = new WizardScene(
      'profile-wizard',
      async (ctx: any) => {
        ctx.wizard.state.p = {};
        const uid = String(ctx.from.id);
        const oldDoc = await getDoc(doc(db, 'users', uid));
        const old = oldDoc.exists() ? oldDoc.data() : null;
        ctx.wizard.state.old = old;
        
        const kbd = [
            [Markup.button.callback('🙎‍♂️ Парень', 'gender_m'), Markup.button.callback('🙎‍♀️ Девушка', 'gender_f')]
        ];
        if (old?.gender) kbd.push([Markup.button.callback('⏩ Оставить текущий пол', 'skip')]);
        
        const msg = await ctx.reply('Кто ты?', Markup.inlineKeyboard(kbd));
        ctx.wizard.state.l = msg.message_id;
        return ctx.wizard.next();
      },
      async (ctx: any) => {
        if (ctx.callbackQuery?.data === 'skip') {
            ctx.wizard.state.p.gender = ctx.wizard.state.old.gender;
        } else if (ctx.callbackQuery) {
            ctx.wizard.state.p.gender = ctx.callbackQuery.data;
        } else return;
        
        await del(ctx, ctx.callbackQuery?.message?.message_id);
        
        const kbd = [
            [Markup.button.callback('🙎‍♂️ Парни', 'target_m'), Markup.button.callback('🙎‍♀️ Девушки', 'target_f')],
            [Markup.button.callback('👫 Все', 'target_any')]
        ];
        if (ctx.wizard.state.old?.target_gender) kbd.push([Markup.button.callback('⏩ Оставить текущее', 'skip')]);
        
        const msg = await ctx.reply('Кто тебя интересует?', Markup.inlineKeyboard(kbd));
        ctx.wizard.state.l = msg.message_id;
        return ctx.wizard.next();
      },
      async (ctx: any) => {
        if (ctx.callbackQuery?.data === 'skip') {
            ctx.wizard.state.p.target_gender = ctx.wizard.state.old.target_gender;
        } else if (ctx.callbackQuery) {
            ctx.wizard.state.p.target_gender = ctx.callbackQuery.data;
        } else return;
        
        await del(ctx, ctx.callbackQuery?.message?.message_id);
        
        const oldName = ctx.wizard.state.old?.name;
        const kbd = oldName ? Markup.inlineKeyboard([[{ text: `⏩ Оставить: ${oldName.substring(0,15)}`, callback_data: 'skip' }]]) : undefined;
        
        const msg = await ctx.reply('Твое имя (или ник)?', kbd);
        ctx.wizard.state.l = msg.message_id;
        return ctx.wizard.next();
      },
      async (ctx: any) => {
        if (ctx.callbackQuery?.data === 'skip') {
            ctx.wizard.state.p.name = ctx.wizard.state.old.name;
        } else if (ctx.message?.text) {
            ctx.wizard.state.p.name = ctx.message.text.substring(0, 50);
            await del(ctx, ctx.message.message_id);
        } else return;
        
        await del(ctx, ctx.wizard.state.l);
        const oldAge = ctx.wizard.state.old?.age;
        const kbd = oldAge ? Markup.inlineKeyboard([[{ text: `⏩ Оставить: ${oldAge}`, callback_data: 'skip' }]]) : undefined;
        
        const msg = await ctx.reply('Сколько лет? (цифрой)', kbd);
        ctx.wizard.state.l = msg.message_id;
        return ctx.wizard.next();
      },
      async (ctx: any) => {
        if (ctx.callbackQuery?.data === 'skip') {
            ctx.wizard.state.p.age = ctx.wizard.state.old.age;
        } else if (ctx.message?.text) {
            const age = parseInt(ctx.message.text);
            if (isNaN(age) || age < 14 || age > 99) {
                const m = await ctx.reply('Введи реальный возраст.', Markup.removeKeyboard());
                await del(ctx, ctx.message.message_id); ctx.wizard.state.l = m.message_id;
                return;
            }
            ctx.wizard.state.p.age = age;
            await del(ctx, ctx.message.message_id);
        } else return;
        
        await del(ctx, ctx.wizard.state.l);
        const oldCity = ctx.wizard.state.old?.city;
        const kbd = oldCity ? Markup.inlineKeyboard([[{ text: `⏩ Оставить: ${oldCity.substring(0,15)}`, callback_data: 'skip' }]]) : undefined;
        
        const msg = await ctx.reply('Твой город?', kbd);
        ctx.wizard.state.l = msg.message_id;
        return ctx.wizard.next();
      },
      async (ctx: any) => {
        if (ctx.callbackQuery?.data === 'skip') {
            ctx.wizard.state.p.city = ctx.wizard.state.old.city;
        } else if (ctx.message?.text) {
            ctx.wizard.state.p.city = ctx.message.text.substring(0, 50);
            await del(ctx, ctx.message.message_id);
        } else return;
        
        await del(ctx, ctx.wizard.state.l);
        const kbd = ctx.wizard.state.old?.bio ? Markup.inlineKeyboard([[{ text: '⏩ Оставить текущее описание', callback_data: 'skip' }]]) : undefined;
        const msg = await ctx.reply('Расскажи о себе:', kbd);
        ctx.wizard.state.l = msg.message_id;
        return ctx.wizard.next();
      },
      async (ctx: any) => {
        if (ctx.callbackQuery?.data === 'skip') {
            ctx.wizard.state.p.bio = ctx.wizard.state.old.bio;
        } else if (ctx.message?.text) {
            ctx.wizard.state.p.bio = ctx.message.text.substring(0, 300);
            await del(ctx, ctx.message.message_id);
        } else return;
        
        await del(ctx, ctx.wizard.state.l);
        const kbd = (ctx.wizard.state.old?.media_id || ctx.wizard.state.old?.photo_url) 
            ? Markup.inlineKeyboard([[{ text: '⏩ Оставить текущее фото/видео', callback_data: 'skip' }]]) : undefined;
            
        const msg = await ctx.reply('Пришли свое фото или видео (кружочек или обычное, до 15 сек)! 📸', kbd);
        ctx.wizard.state.l = msg.message_id;
        return ctx.wizard.next();
      },
      async (ctx: any) => {
        if (ctx.callbackQuery?.data === 'skip') {
            ctx.wizard.state.p.media_id = ctx.wizard.state.old.media_id || ctx.wizard.state.old.photo_url;
            ctx.wizard.state.p.media_type = ctx.wizard.state.old.media_type || 'photo';
        } else if (ctx.message?.photo) {
            ctx.wizard.state.p.media_id = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            ctx.wizard.state.p.media_type = 'photo';
            await del(ctx, ctx.message.message_id);
        } else if (ctx.message?.video) {
            if (ctx.message.video.duration > 15) {
                const m = await ctx.reply('Видео слишком длинное! Максимум 15 секунд.');
                await del(ctx, ctx.message.message_id);
                return;
            }
            ctx.wizard.state.p.media_id = ctx.message.video.file_id;
            ctx.wizard.state.p.media_type = 'video';
            await del(ctx, ctx.message.message_id);
        } else if (ctx.message?.video_note) {
            ctx.wizard.state.p.media_id = ctx.message.video_note.file_id;
            ctx.wizard.state.p.media_type = 'video';
            await del(ctx, ctx.message.message_id);
        } else if (ctx.message?.animation) {
            ctx.wizard.state.p.media_id = ctx.message.animation.file_id;
            ctx.wizard.state.p.media_type = 'animation';
            await del(ctx, ctx.message.message_id);
        } else {
            return;
        }
        
        await del(ctx, ctx.wizard.state.l);
        
        const telegramId = String(ctx.from.id);
        const p = ctx.wizard.state.p;
        const profileData = {
            telegram_id: telegramId, username: ctx.from.username || '',
            name: p.name, gender: p.gender, target_gender: p.target_gender,
            age: p.age, city: p.city, bio: p.bio, 
            media_id: p.media_id, media_type: p.media_type,
            updated_at: serverTimestamp(), active: true
        };
        
        try {
            await setDoc(doc(db, 'users', telegramId), profileData, { merge: true });
            await ctx.reply('✅ Твоя анкета сохранена и готова!', mainMenu);
            await showMyProfile(ctx, telegramId);
        } catch (err: any) { await ctx.reply(`Ошибка: ${err.message}`); }
        return ctx.scene.leave();
      }
    );

    const stage = new Stage([profileWizard]);
    bot.catch((err) => console.error("Bot Error", err));
    bot.use(session());
    bot.use(stage.middleware() as any);

    bot.start((ctx) => ctx.reply('Привет! Разреши мне найти тебе пару. 💘', Markup.inlineKeyboard([[{ text: '📝 Заполнить анкету', callback_data: 'edit_profile' }]])));

    // MY PROFILE SYSTEM
    async function showMyProfile(ctx: any, telegramId: string) {
        if (ctx.session?.myProfileMsgId) {
            await del(ctx, ctx.session.myProfileMsgId);
        }
        
        const userDoc = await getDoc(doc(db, 'users', telegramId));
        if (!userDoc.exists()) return ctx.reply('У тебя еще нет профиля!', Markup.inlineKeyboard([[{ text: '📝 Создать', callback_data: 'edit_profile' }]]));
        const d = userDoc.data()!;
        
        if (!d.media_id && d.photo_url) {
            d.media_id = d.photo_url;
            d.media_type = 'photo';
        }
        
        const status = d.active ? '🟢 Анкета показывается другим' : '💤 Анкета скрыта из поиска';
        const caption = `<b>Твоя анкета:</b>\n\n${d.name}, ${d.age}, ${d.city}\n${d.bio}\n\n<i>${status}</i>`;
        
        const kbd = Markup.inlineKeyboard([
            [{ text: '✏️ Редактировать профиль', callback_data: 'edit_profile' }],
            [{ text: d.active ? '💤 Больше никого не ищу' : '🚀 Возобновить поиск', callback_data: 'toggle_active' }]
        ]);
        
        const msg = await sendMedia(ctx, d, caption, kbd.reply_markup);
        if (ctx.session) ctx.session.myProfileMsgId = msg.message_id;
    }

    bot.hears('👤 Моя анкета', (ctx) => showMyProfile(ctx, String(ctx.from.id)));
    bot.action('edit_profile', async (ctx: any) => { 
        await ctx.answerCbQuery();
        if (ctx.session) ctx.session.myProfileMsgId = null;
        await del(ctx, ctx.callbackQuery.message.message_id); 
        ctx.scene.enter('profile-wizard'); 
    });
    bot.action('toggle_active', async (ctx: any) => {
        const uid = String(ctx.from.id);
        const ref = doc(db, 'users', uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
            const newState = !snap.data().active;
            await setDoc(ref, { active: newState }, { merge: true });
            ctx.answerCbQuery(newState ? 'Поиск включен!' : 'Анкета скрыта!');
            await showMyProfile(ctx, uid);
        }
    });

    // DISCOVERY SYSTEM
    async function showNextProfile(ctx: any, telegramId: string) {
        try {
            const userDoc = await getDoc(doc(db, 'users', telegramId));
            if (!userDoc.exists()) return ctx.reply('Сначала заполни анкету!', Markup.inlineKeyboard([[{ text: '📝 Создать', callback_data: 'edit_profile' }]]));
            const myProfile = userDoc.data()!;
            
            if (!myProfile.active) return ctx.reply('Твоя анкета сейчас выключена! 💤 Включи её в меню "👤 Моя анкета", чтобы кого-то искать.', mainMenu);

            const intQuery = query(collection(db, 'interactions'), where('from_user_id', '==', telegramId));
            const interactions = await getDocs(intQuery);
            const interactedIds = new Set(interactions.docs.map(d => d.data().to_user_id));
            interactedIds.add(telegramId);
            
            let usersQuery = query(collection(db, 'users'), where('active', '==', true), limit(50));
            if (myProfile.target_gender !== 'target_any') {
                usersQuery = query(collection(db, 'users'), where('active', '==', true), where('gender', '==', myProfile.target_gender), limit(50));
            }
            
            const candidates = await getDocs(usersQuery);
            let candidateToShow = null;
            for (const cDoc of candidates.docs) {
                if (interactedIds.has(cDoc.id)) continue;
                const b = cDoc.data();
                if (b.target_gender !== 'target_any' && b.target_gender !== myProfile.gender) continue;
                candidateToShow = b;
                break;
            }
            
            if (!candidateToShow) {
                const sleepMsg = await ctx.reply('Ждем пока кто-нибудь увидит твою анкету... 🏜️ А пока новых нет.');
                if (ctx.session) ctx.session.lastSearchMsgId = sleepMsg.message_id;
                return;
            }
            
            const caption = `<b>${candidateToShow.name}, ${candidateToShow.age}, ${candidateToShow.city}</b>\n\n${candidateToShow.bio}`;
            const kbd = Markup.inlineKeyboard([
                [
                    { text: '👎', callback_data: `dislike_${candidateToShow.telegram_id}` },
                    { text: '💤', callback_data: `sleep` },
                    { text: '❤️', callback_data: `like_${candidateToShow.telegram_id}` }
                ]
            ]);
            
            const msg = await sendMedia(ctx, candidateToShow, caption, kbd.reply_markup);
            if (ctx.session) ctx.session.lastSearchMsgId = msg.message_id;
            
        } catch (err) { console.error(err); ctx.reply('Ошибка поиска.', mainMenu); }
    }

    bot.hears('🔥 Смотреть анкеты', async (ctx: any) => {
        if (ctx.session?.lastSearchMsgId) await del(ctx, ctx.session.lastSearchMsgId);
        await showNextProfile(ctx, String(ctx.from.id));
    });
    bot.command('search', (ctx) => showNextProfile(ctx, String(ctx.from?.id)));

    bot.action('sleep', async (ctx: any) => {
        await ctx.answerCbQuery('Перерыв ☕');
        await del(ctx, ctx.callbackQuery.message.message_id);
        if (ctx.session) ctx.session.lastSearchMsgId = null;
    });

    // INTERACTIONS
    bot.action(/^like_(.+)$/, async (ctx: any) => {
        const toUserId = ctx.match[1];
        const fromUserId = String(ctx.from?.id);
        try {
            await setDoc(doc(db, 'interactions', `${fromUserId}_${toUserId}`), { from_user_id: fromUserId, to_user_id: toUserId, type: 'like', created_at: serverTimestamp() });
            
            await del(ctx, ctx.callbackQuery.message.message_id);
            
            const matchDoc = await getDoc(doc(db, 'interactions', `${toUserId}_${fromUserId}`));
            if (matchDoc.exists() && matchDoc.data()?.type === 'like') {
                const myD = (await getDoc(doc(db, 'users', fromUserId))).data()!;
                const otherD = (await getDoc(doc(db, 'users', toUserId))).data()!;
                const myUrl = myD.username ? `https://t.me/${myD.username}` : `tg://user?id=${fromUserId}`;
                const otherUrl = otherD.username ? `https://t.me/${otherD.username}` : `tg://user?id=${toUserId}`;
                
                ctx.answerCbQuery('💎 Мэтч!', { showAlert: true });
                
                const matchKbdYou = Markup.inlineKeyboard([[{ text: `💬 Написать ${otherD.name}`, url: otherUrl }]]);
                await sendMedia(ctx, otherD, `<b>Взаимная симпатия с ${otherD.name}!</b> ❤️\nНе стесняйся, пиши!`, matchKbdYou.reply_markup);
                
                const matchKbdThem = Markup.inlineKeyboard([[{ text: `💬 Написать ${myD.name}`, url: myUrl }]]);
                
                const sendMethod = myD.media_type === 'video' ? bot.telegram.sendVideo.bind(bot.telegram) : (myD.media_type === 'animation' ? bot.telegram.sendAnimation.bind(bot.telegram) : bot.telegram.sendPhoto.bind(bot.telegram));
                const mediaId = myD.media_id || myD.photo_url;
                
                await sendMethod(toUserId, mediaId, { caption: `<b>Взаимная симпатия!</b> ❤️\nТы понравился(ась) ${myD.name}!`, reply_markup: matchKbdThem.reply_markup as any, parse_mode: 'HTML' });
            } else {
                ctx.answerCbQuery('❤️');
            }
            await showNextProfile(ctx, fromUserId);
        } catch (err) { ctx.answerCbQuery('Ошибка'); }
    });

    bot.action(/^dislike_(.+)$/, async (ctx: any) => {
        const toUserId = ctx.match[1];
        const fromUserId = String(ctx.from?.id);
        try {
            await setDoc(doc(db, 'interactions', `${fromUserId}_${toUserId}`), { from_user_id: fromUserId, to_user_id: toUserId, type: 'dislike', created_at: serverTimestamp() });
            await del(ctx, ctx.callbackQuery.message.message_id);
            ctx.answerCbQuery('👎');
            await showNextProfile(ctx, fromUserId);
        } catch (err) { ctx.answerCbQuery('Ошибка'); }
    });

    bot.launch();
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
    console.log('Bot is running heavily optimized...');
}
