import { Telegraf, session, Scenes, Markup } from 'telegraf';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, query, where, limit, serverTimestamp, getCountFromServer } from 'firebase/firestore';
import express from 'express';
import * as fs from 'fs';
import 'dotenv/config';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf-8'));
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) console.error("CRITICAL ERROR: TELEGRAM_BOT_TOKEN IS MISSING!");

// Для получения репортов администратор должен запустить бота! 
// Если у бота не получается отправить сообщение по юзернейму, укажите ADMIN_ID в .env файле.
const ADMIN_CHAT_ID = process.env.ADMIN_ID || '@vNEZDv'; 

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const expressApp = express();
expressApp.get('/', (req, res) => res.send(`Bot is Active and Ready`));

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

    const formatCard = (d: any) => {
        const premiumBadge = d.is_premium ? ' VIP' : '';
        return `<b>${d.name}, ${d.age}, ${d.city}</b>${premiumBadge} – ${d.bio}`;
    };

    bot.telegram.setMyCommands([
        { command: 'search', description: '🚀 Смотреть анкеты' },
        { command: 'find', description: '🔍 Поиск по словам' },
        { command: 'myprofile', description: '👤 Моя анкета' },
        { command: 'sleep', description: '💤 Отключить анкету' },
        { command: 'premium', description: '⭐ Premium' },
        { command: 'complaint', description: '🚫 Пожаловаться' },
        { command: 'stats', description: '📊 Статистика (Админы)' }
    ]).catch(()=>{});

    // ----------------------------------------
    // WIZARD: PROFILE CREATION
    // ----------------------------------------
    const profileWizard = new WizardScene(
      'profile-wizard',
      async (ctx: any) => {
        ctx.wizard.state.p = {};
        const uid = String(ctx.from.id);
        const oldDoc = await getDoc(doc(db, 'users', uid));
        const old = oldDoc.exists() ? oldDoc.data() : null;
        ctx.wizard.state.old = old;
        
        const kbd = [
            [Markup.button.callback('🙎‍♂️ Я парень', 'gender_m'), Markup.button.callback('🙎‍♀️ Я девушка', 'gender_f')]
        ];
        if (old?.gender) kbd.push([Markup.button.callback('✨ Оставить как есть', 'skip')]);
        
        const msg = await ctx.reply('<b>Шаг 1/7</b>\nДобро пожаловать. Укажи свой пол:', { parse_mode: 'HTML', ...Markup.inlineKeyboard(kbd) });
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
            [Markup.button.callback('🙎‍♂️ Парней', 'target_m'), Markup.button.callback('🙎‍♀️ Девушек', 'target_f')],
            [Markup.button.callback('👫 Мне не важен пол', 'target_any')]
        ];
        if (ctx.wizard.state.old?.target_gender) kbd.push([Markup.button.callback('✨ Оставить как есть', 'skip')]);
        
        const msg = await ctx.reply('<b>Шаг 2/7</b>\nКого будем искать?', { parse_mode: 'HTML', ...Markup.inlineKeyboard(kbd) });
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
        const kbd = oldName ? Markup.inlineKeyboard([[{ text: `✨ Оставить: ${oldName.substring(0,15)}`, callback_data: 'skip' }]]) : undefined;
        
        const msg = await ctx.reply('<b>Шаг 3/7</b>\nТвое имя (или ник)?', { parse_mode: 'HTML', ...kbd });
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
        const kbd = oldAge ? Markup.inlineKeyboard([[{ text: `✨ Оставить: ${oldAge}`, callback_data: 'skip' }]]) : undefined;
        
        const msg = await ctx.reply('<b>Шаг 4/7</b>\nСколько тебе лет? (цифрами)', { parse_mode: 'HTML', ...kbd });
        ctx.wizard.state.l = msg.message_id;
        return ctx.wizard.next();
      },
      async (ctx: any) => {
        if (ctx.callbackQuery?.data === 'skip') {
            ctx.wizard.state.p.age = ctx.wizard.state.old.age;
        } else if (ctx.message?.text) {
            const age = parseInt(ctx.message.text);
            if (isNaN(age) || age < 14 || age > 99) {
                const m = await ctx.reply('Пожалуйста, введи корректный возраст от 14 до 99.', Markup.removeKeyboard());
                await del(ctx, ctx.message.message_id); ctx.wizard.state.l = m.message_id;
                return;
            }
            ctx.wizard.state.p.age = age;
            await del(ctx, ctx.message.message_id);
        } else return;
        
        await del(ctx, ctx.wizard.state.l);
        const oldCity = ctx.wizard.state.old?.city;
        const kbd = oldCity ? Markup.inlineKeyboard([[{ text: `✨ Оставить: ${oldCity.substring(0,15)}`, callback_data: 'skip' }]]) : undefined;
        
        const msg = await ctx.reply('<b>Шаг 5/7</b>\nИз какого ты города?', { parse_mode: 'HTML', ...kbd });
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
        const kbd = ctx.wizard.state.old?.bio ? Markup.inlineKeyboard([[{ text: '✨ Оставить текущее описание', callback_data: 'skip' }]]) : undefined;
        const msg = await ctx.reply('<b>Шаг 6/7</b>\nРасскажи о себе и своих увлечениях\n<i>(Будет показано в анкете)</i>', { parse_mode: 'HTML', ...kbd });
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
            ? Markup.inlineKeyboard([[{ text: '✨ Оставить текущее фото/видео', callback_data: 'skip' }]]) : undefined;
            
        const msg = await ctx.reply('<b>Шаг 7/7</b>\nПрикрепи свое фото или видео-кружок (до 15 сек).', { parse_mode: 'HTML', ...kbd });
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
                const m = await ctx.reply('Загрузите видео покороче (до 15 сек).');
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
            await ctx.reply('<b>Анкета сохранена!</b>', { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } });
            await showMyProfile(ctx, telegramId);
        } catch (err: any) { await ctx.reply(`Ошибка БД: ${err.message}`); }
        return ctx.scene.leave();
      }
    );

    // ----------------------------------------
    // WIZARD: SMART SEARCH
    // ----------------------------------------
    const interestWizard = new WizardScene(
        'interest-wizard',
        async (ctx: any) => {
            const msg = await ctx.reply("🔍 <b>Умный поиск по интересу</b>\n\nНапиши ключевое слово (например: <i>аниме, спорт, it, музыка, авто</i>). Бот найдет все анкеты, где в описании есть это слово!", 
                { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } }
            );
            ctx.wizard.state.l = msg.message_id;
            return ctx.wizard.next();
        },
        async (ctx: any) => {
            if (ctx.message?.text) {
                const querytext = ctx.message.text.substring(0, 30);
                if (!ctx.session) ctx.session = {};
                ctx.session.currentSearchQuery = querytext;
                
                await ctx.reply(`🎯 Ищем анкеты со словом: <b>${querytext}</b>...\n<i>(Для сброса фильтра нажми /search)</i>`, { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } });
                await showNextProfile(ctx, String(ctx.from.id));
            }
            return ctx.scene.leave();
        }
    );

    // Быстрое редактирование
    const quickPhotoWizard = new WizardScene(
        'quick-photo',
        async (ctx: any) => {
            const msg = await ctx.reply('📸 <b>Смена фото</b>\nПришлите новое фото или видео-кружок (до 15 сек):', { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } });
            ctx.wizard.state.l = msg.message_id; return ctx.wizard.next();
        },
        async (ctx: any) => {
            let mid, mtype;
            if (ctx.message?.photo) { mid = ctx.message.photo[ctx.message.photo.length - 1].file_id; mtype = 'photo'; }
            else if (ctx.message?.video && ctx.message.video.duration <= 15) { mid = ctx.message.video.file_id; mtype = 'video'; }
            else if (ctx.message?.video_note) { mid = ctx.message.video_note.file_id; mtype = 'video'; }
            else if (ctx.message?.animation) { mid = ctx.message.animation.file_id; mtype = 'animation'; }
            else return;
            await del(ctx, ctx.message.message_id); await del(ctx, ctx.wizard.state.l);
            await setDoc(doc(db, 'users', String(ctx.from.id)), { media_id: mid, media_type: mtype, updated_at: serverTimestamp() }, { merge: true });
            await ctx.reply('✅ Фото обновлено!', { reply_markup: { remove_keyboard: true } }); await showMyProfile(ctx, String(ctx.from.id)); return ctx.scene.leave();
        }
    );
    const quickBioWizard = new WizardScene(
        'quick-bio',
        async (ctx: any) => {
            const msg = await ctx.reply('📝 <b>Смена текста</b>\nНапиши новое описание о себе:', { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } });
            ctx.wizard.state.l = msg.message_id; return ctx.wizard.next();
        },
        async (ctx: any) => {
            if (ctx.message?.text) {
                await del(ctx, ctx.message.message_id); await del(ctx, ctx.wizard.state.l);
                await setDoc(doc(db, 'users', String(ctx.from.id)), { bio: ctx.message.text.substring(0, 300), updated_at: serverTimestamp() }, { merge: true });
                await ctx.reply('✅ Описание обновлено!', { reply_markup: { remove_keyboard: true } }); await showMyProfile(ctx, String(ctx.from.id));
            }
            return ctx.scene.leave();
        }
    );
    const quickCityWizard = new WizardScene(
        'quick-city',
        async (ctx: any) => {
            const msg = await ctx.reply('🌆 <b>Смена города</b>\nВведи свой новый город:', { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } });
            ctx.wizard.state.l = msg.message_id; return ctx.wizard.next();
        },
        async (ctx: any) => {
            if (ctx.message?.text) {
                await del(ctx, ctx.message.message_id); await del(ctx, ctx.wizard.state.l);
                await setDoc(doc(db, 'users', String(ctx.from.id)), { city: ctx.message.text.substring(0, 50), updated_at: serverTimestamp() }, { merge: true });
                await ctx.reply('✅ Город обновлен!', { reply_markup: { remove_keyboard: true } }); await showMyProfile(ctx, String(ctx.from.id));
            }
            return ctx.scene.leave();
        }
    );

    const quickAgeWizard = new WizardScene(
        'quick-age',
        async (ctx: any) => {
            const msg = await ctx.reply('<b>Смена возраста</b>\nВведите ваш возраст (цифрами):', { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } });
            ctx.wizard.state.l = msg.message_id; return ctx.wizard.next();
        },
        async (ctx: any) => {
            if (ctx.message?.text) {
                const age = parseInt(ctx.message.text);
                if (isNaN(age) || age < 14 || age > 99) {
                    await ctx.reply('Пожалуйста, введите корректный возраст от 14 до 99.');
                    return;
                }
                await del(ctx, ctx.message.message_id); await del(ctx, ctx.wizard.state.l);
                await setDoc(doc(db, 'users', String(ctx.from.id)), { age, updated_at: serverTimestamp() }, { merge: true });
                await ctx.reply('✅ Возраст обновлен!', { reply_markup: { remove_keyboard: true } }); await showMyProfile(ctx, String(ctx.from.id));
            }
            return ctx.scene.leave();
        }
    );

    const stage = new Stage([profileWizard, interestWizard, quickPhotoWizard, quickBioWizard, quickCityWizard, quickAgeWizard]);
    
    bot.catch(async (err: any, ctx: any) => {
        console.error("Bot Global Error:", err);
        try {
            if (ctx.callbackQuery) {
                await ctx.answerCbQuery('🔄 Идет обновление бота...', { show_alert: false }).catch(()=>{});
            }
            if (ctx.scene) await ctx.scene.leave().catch(()=>{});
            await ctx.reply('🔄 <b>Бот был обновлен.</b>\nСессия восстановлена, продолжаем работу! 👇', { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } }).catch(()=>{});
        } catch(e) {
            console.error("Recovery failed", e);
        }
    });

    bot.use(session());
    bot.use(stage.middleware() as any);

    bot.start(async (ctx: any) => {
        bot.telegram.setMyCommands([
            { command: 'search', description: '🚀 Смотреть анкеты' },
            { command: 'find', description: '🔍 Поиск по словам' },
            { command: 'myprofile', description: '👤 Моя анкета' },
            { command: 'sleep', description: '💤 Отключить анкету' },
            { command: 'premium', description: '⭐ Premium' },
            { command: 'complaint', description: '🚫 Пожаловаться' },
            { command: 'stats', description: '📊 Статистика (Админы)' }
        ]).catch(()=>{});

        const uid = String(ctx.from?.id);
        const refDoc = doc(db, 'users', uid);
        const userDoc = await getDoc(refDoc);
        
        // В Telegraf payload стартовой команды можно получить через ctx.payload или распарсив команду:
        const payload = ctx.payload || (ctx.message?.text?.split(' ')[1]);

        if (userDoc.exists()) {
            if (userDoc.data().banned) return ctx.reply('⛔ <b>Ваш аккаунт заблокирован.</b>', { parse_mode: 'HTML' });
            await ctx.reply('<b>С возвращением!</b> Нажимай /search, чтобы продолжить поиск! 💘', { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } });
        } else {
            let premiumUntil = 0;
            if (payload && payload !== uid) {
                const inviterDocRef = doc(db, 'users', payload);
                const inviterDoc = await getDoc(inviterDocRef);
                
                if (inviterDoc.exists() && !inviterDoc.data().banned) {
                    const oldInviterPremium = inviterDoc.data().premium_until || Date.now();
                    const newInviterPremium = Math.max(oldInviterPremium, Date.now()) + (3 * 24 * 60 * 60 * 1000);
                    await setDoc(inviterDocRef, { is_premium: true, premium_until: newInviterPremium }, { merge: true });
                    
                    try {
                        await bot.telegram.sendMessage(payload, '🎁 <b>По твоей ссылке зарегистрировался новый друг!</b>\n Тебе начислено +3 дня VIP статуса! 💎', { parse_mode: 'HTML' });
                    } catch(e) {}
                    
                    premiumUntil = Date.now() + (3 * 24 * 60 * 60 * 1000);
                    await ctx.reply('🎁 <b>Поздравляем!</b> Ты перешел по приглашению и сразу получаешь <b>3 дня VIP-статуса</b>! 💎', { parse_mode: 'HTML' });
                }
            }

            // Создаем болванку для пользователя, чтобы закрепить за ним VIP (если есть).
            await setDoc(refDoc, {
                telegram_id: uid,
                username: ctx.from?.username || '',
                active: false,
                created_at: serverTimestamp(),
                is_premium: premiumUntil > 0,
                premium_until: premiumUntil
            });

            await ctx.reply('<b>Привет! Бот на связи.</b>\nТут можно найти компанию, половину или друзей.\n\nЖми кнопку ниже, чтобы заполнить анкету!', 
            { parse_mode: 'HTML', ...Markup.inlineKeyboard([[{ text: 'Создать профиль', callback_data: 'edit_profile' }]]) }
            );
        }
    });

    bot.command('complaint', async (ctx: any) => {
        if (ctx.message) await del(ctx, ctx.message.message_id).catch(()=>{});
        if (!ctx.session?.candidate_id) {
            return ctx.reply('⚠️ Жалобу можно оставлять только во время просмотра анкеты.');
        }

        const targetId = ctx.session.candidate_id;
        const kbd = Markup.inlineKeyboard([
            [Markup.button.callback('🔞 Материал для взрослых', `repR_1_${targetId}`)],
            [Markup.button.callback('💰 Продажа товаров и услуг', `repR_2_${targetId}`)],
            [Markup.button.callback('💩 Спам/Мошенничество', `repR_3_${targetId}`)],
            [Markup.button.callback('🦨 Другое', `repR_4_${targetId}`)],
            [Markup.button.callback('Отмена', `repCancel_${targetId}`)]
        ]);

        await ctx.reply(`Укажите причину жалобы на эту анкету:`, kbd);
    });

    bot.command('premium', async (ctx: any) => {
        const uid = String(ctx.from.id);
        const userDoc = await getDoc(doc(db, 'users', uid));
        const d = userDoc.exists() ? userDoc.data() : null;
        
        let text = '<b>Premium Статус</b> ⭐\n\nPremium поднимает вашу анкету в выдаче!';
        let premBtnText = '💎 VIP-буст (ПЛАТНО)';

        if (d && d.is_premium) {
            text += '\n\n💎 <b>Активен Premium-статус!</b>\nВаша анкета поднята в поиске.';
            premBtnText = '💎 Продлить Premium';
        }

        const kbd = Markup.inlineKeyboard([
            [{ text: premBtnText, callback_data: 'buy_premium' }],
            [{ text: '🎁 Привести друга (Бесплатный VIP)', callback_data: 'ref_friend' }]
        ]);

        await ctx.reply(text, { parse_mode: 'HTML', ...kbd });
    });

    bot.action('ref_friend', async (ctx: any) => {
        await ctx.answerCbQuery();
        const myId = ctx.from.id;
        const botInfo = await bot.telegram.getMe();
        const refLink = `https://t.me/${botInfo.username}?start=${myId}`;
        
        const header = `<b>Бесплатный VIP за друзей!</b>\nПерешли сообщение ниже друзьям.\nКогда друг запустит бота, <b>вы оба получите по 3 дня VIP</b>!`;
        await ctx.reply(header, { parse_mode: 'HTML' });

        const copyText = `Привет! Нашел крутого бота для знакомств @${botInfo.username}\n\nЗаходи по моей ссылке ниже, чтобы нам обоим дали VIP-статус:\n\n${refLink}`;
        await ctx.reply(copyText);
    });

    bot.command('myprofile', async (ctx: any) => {
        await showMyProfile(ctx, String(ctx.from.id));
    });
    bot.action('my_profile', async (ctx: any) => {
        await ctx.answerCbQuery();
        await showMyProfile(ctx, String(ctx.from.id));
    });

    async function showMyProfile(ctx: any, telegramId: string) {
        if (ctx.session?.myProfileMsgId) {
            await del(ctx, ctx.session.myProfileMsgId);
            await del(ctx, ctx.session.myProfileMenuMsgId);
        }
        
        const userDoc = await getDoc(doc(db, 'users', telegramId));
        if (!userDoc.exists()) return ctx.reply('У тебя еще нет профиля!', Markup.inlineKeyboard([[{ text: '📝 Создать анкету', callback_data: 'edit_profile' }]]));
        const d = userDoc.data()!;
        
        if (!d.media_id && d.photo_url) { d.media_id = d.photo_url; d.media_type = 'photo'; }
        
        const caption = formatCard(d);
        const sentMsg = await sendMedia(ctx, d, caption, undefined);
        
        const menuText = `Так выглядит твоя анкета:\n\n1. Смотреть анкеты.\n2. Заполнить анкету заново.\n3. Изменить фото/видео.\n4. Изменить текст анкеты.\n5. Изменить возраст и город.\n***\n6. Активируй Premium — будь в топе ⭐\n7. 📊 Статистика анкеты`;
        
        const kbd = Markup.keyboard([
            ['1 🚀', '2', '3', '4', '5'],
            ['6 ⭐', '7 📊']
        ]).resize();
        
        const menuMsg = await ctx.reply(menuText, { parse_mode: 'HTML', ...kbd });
        
        if (sentMsg && menuMsg) {
            if (!ctx.session) ctx.session = {};
            ctx.session.myProfileMsgId = sentMsg.message_id;
            ctx.session.myProfileMenuMsgId = menuMsg.message_id;
        }
    }

    bot.hears('1', async (ctx: any) => {
        if (ctx.message) await del(ctx, ctx.message.message_id).catch(()=>{});
        if (ctx.session?.in_sleep_menu) {
            ctx.session.in_sleep_menu = false;
            await showNextProfile(ctx, String(ctx.from.id));
        }
    });

    bot.hears('1 🚀', async (ctx: any) => {
        if (ctx.message) await del(ctx, ctx.message.message_id).catch(()=>{});
        await showNextProfile(ctx, String(ctx.from.id));
    });
    bot.hears('2', async (ctx: any) => {
        if (ctx.message) await del(ctx, ctx.message.message_id).catch(()=>{});
        if (ctx.session?.in_sleep_menu) {
            ctx.session.in_sleep_menu = false;
            await showMyProfile(ctx, String(ctx.from.id));
        } else {
            ctx.scene.enter('profile-wizard');
        }
    });
    bot.hears('3', async (ctx: any) => {
        if (ctx.message) await del(ctx, ctx.message.message_id).catch(()=>{});
        if (ctx.session?.in_sleep_menu) {
            ctx.session.in_sleep_menu = false;
            ctx.session.confirm_disable = true;
            const kbd = Markup.keyboard([['😴 Отключить анкету']]).resize();
            await ctx.reply('Так ты не узнаешь, что кому-то нравишься... Точно хочешь отключить свою анкету?', { ...kbd });
        } else {
            ctx.scene.enter('quick-photo');
        }
    });
    bot.hears('😴 Отключить анкету', async (ctx: any) => {
        if (ctx.message) await del(ctx, ctx.message.message_id).catch(()=>{});
        if (ctx.session?.confirm_disable) {
             ctx.session.confirm_disable = false;
             const uid = String(ctx.from.id);
             await setDoc(doc(db, 'users', uid), { active: false }, { merge: true });
             await ctx.reply('Надеюсь ты нашел кого-то благодаря мне! Рад был с тобой пообщаться, будет скучно — пиши, обязательно найдем тебе кого-нибудь ❤️', { reply_markup: { remove_keyboard: true } });
        }
    });
    bot.hears('4', async (ctx: any) => {
        if (ctx.message) await del(ctx, ctx.message.message_id).catch(()=>{});
        if (ctx.session?.in_sleep_menu) {
            ctx.session.in_sleep_menu = false;
            ctx.match = ['buy_premium']; 
            bot.handleUpdate({
                 update_id: Date.now(),
                 message: { message_id: Date.now(), date: Date.now(), chat: ctx.chat, from: ctx.from, text: '/premium' }
            } as any);
        } else {
            ctx.scene.enter('quick-bio');
        }
    });
    bot.hears('5', async (ctx: any) => {
        if (ctx.message) await del(ctx, ctx.message.message_id).catch(()=>{});
        await ctx.reply('Что именно изменить?', Markup.inlineKeyboard([
            [{ text: 'Изменить город', callback_data: 'quick_city' }],
            [{ text: 'Изменить возраст', callback_data: 'quick_age' }]
        ]));
    });
    bot.hears('6 ⭐', async (ctx: any) => {
        if (ctx.message) await del(ctx, ctx.message.message_id).catch(()=>{});
        // Call the exact same logic as buy_premium callback
        ctx.match = ['buy_premium']; 
        // We reuse the command logic easily
        bot.handleUpdate({
             update_id: Date.now(),
             message: { message_id: Date.now(), date: Date.now(), chat: ctx.chat, from: ctx.from, text: '/premium' }
        } as any);
    });
    bot.hears('7 📊', async (ctx: any) => {
        if (ctx.message) await del(ctx, ctx.message.message_id).catch(()=>{});
        const uid = String(ctx.from.id);
        try {
            const snap = await getDocs(query(collection(db, 'interactions'), where('to_user_id', '==', uid)));
            let views = 0; let likes = 0; let superlikes = 0;
            snap.forEach(d => {
                views++;
                const data = d.data();
                if (data.type === 'like') { likes++; if (data.is_superlike) superlikes++; }
            });
            await ctx.reply(`📊 Ваша популярность\n\n👁 Показов анкеты: ${views}\n❤️ Получено лайков: ${likes}\n⭐ Из них суперлайков: ${superlikes}`);
        } catch (e) {
            console.error(e);
            await ctx.reply('Не удалось загрузить данные');
        }
    });

    bot.action('btn_search', async (ctx: any) => {
        await ctx.answerCbQuery();
        if (ctx.callbackQuery.message) await del(ctx, ctx.callbackQuery.message.message_id);
        await showNextProfile(ctx, String(ctx.from.id));
    });

    bot.action('btn_params', async (ctx: any) => {
        await ctx.answerCbQuery();
        await ctx.editMessageReplyMarkup({
            inline_keyboard: [
                [{ text: 'Изменить город', callback_data: 'quick_city' }],
                [{ text: 'Изменить возраст', callback_data: 'quick_age' }],
                [{ text: 'Назад', callback_data: 'my_profile' }]
            ]
        }).catch(()=>{});
    });

    bot.action('my_stats', async (ctx: any) => {
        const uid = String(ctx.from.id);
        try {
            const snap = await getDocs(query(collection(db, 'interactions'), where('to_user_id', '==', uid)));
            let views = 0;
            let likes = 0;
            let superlikes = 0;
            
            snap.forEach(d => {
                views++;
                const data = d.data();
                if (data.type === 'like') {
                    likes++;
                    if (data.is_superlike) superlikes++;
                }
            });

            const text = `📊 Ваша популярность\n\n👁 Показов анкеты: ${views}\n❤️ Получено лайков: ${likes}\n⭐ Из них суперлайков: ${superlikes}`;
            await ctx.answerCbQuery(text, { showAlert: true });
        } catch (e) {
            console.error(e);
            await ctx.answerCbQuery('Не удалось загрузить данные', { showAlert: true });
        }
    });

    bot.action('full_edit', async (ctx: any) => { 
        if (ctx.callbackQuery.message) await del(ctx, ctx.callbackQuery.message.message_id);
        ctx.scene.enter('profile-wizard');
    });
    bot.action('edit_profile', async (ctx: any) => { 
        if (ctx.callbackQuery.message) await del(ctx, ctx.callbackQuery.message.message_id);
        ctx.scene.enter('profile-wizard');
    });
    bot.action('quick_photo', async (ctx: any) => { 
        if (ctx.callbackQuery.message) await del(ctx, ctx.callbackQuery.message.message_id);
        ctx.scene.enter('quick-photo');
    });
    bot.action('quick_bio', async (ctx: any) => { 
        if (ctx.callbackQuery.message) await del(ctx, ctx.callbackQuery.message.message_id);
        ctx.scene.enter('quick-bio');
    });
    bot.action('quick_city', async (ctx: any) => { 
        if (ctx.callbackQuery.message) await del(ctx, ctx.callbackQuery.message.message_id);
        ctx.scene.enter('quick-city');
    });
    bot.action('quick_age', async (ctx: any) => { 
        if (ctx.callbackQuery.message) await del(ctx, ctx.callbackQuery.message.message_id);
        ctx.scene.enter('quick-age');
    });
    bot.action('view_likes', async (ctx: any) => {
        await ctx.answerCbQuery();
        if (!ctx.session) ctx.session = {};
        ctx.session.view_likes_mode = true;
        await showNextProfile(ctx, String(ctx.from.id));
    });

    // ----------------------------------------
    // DISCOVERY SYSTEM (SMART MATCHING & PREMIUM)
    // ----------------------------------------
    async function showNextProfile(ctx: any, telegramId: string) {
        try {
            const userDoc = await getDoc(doc(db, 'users', telegramId));
            if (!userDoc.exists()) return ctx.reply('Надо заполнить анкету!', Markup.inlineKeyboard([[{ text: '📝 Заполнить', callback_data: 'edit_profile' }]]));
            const myProfile = userDoc.data()!;
            
            if (myProfile.banned) {
                return ctx.reply('⛔ <b>Ваш аккаунт заблокирован за нарушение правил.</b>', { parse_mode: 'HTML' });
            }
            if (!myProfile.active) {
                await setDoc(doc(db, 'users', telegramId), { active: true }, { merge: true });
                myProfile.active = true;
            }

            const intQuery = query(collection(db, 'interactions'), where('from_user_id', '==', telegramId));
            const interactions = await getDocs(intQuery);
            const interactedMap = new Map();
            interactions.forEach(d => {
                const data = d.data();
                interactedMap.set(data.to_user_id, data.created_at?.toMillis?.() || Date.now());
            });
            
            let usersQuery = query(collection(db, 'users'), where('active', '==', true), limit(400));
            if (myProfile.target_gender !== 'target_any') {
                const searchGender = myProfile.target_gender === 'target_m' ? 'gender_m' : 'gender_f';
                usersQuery = query(collection(db, 'users'), where('active', '==', true), where('gender', '==', searchGender), limit(400));
            }
            
            const candidates = await getDocs(usersQuery);
            let unseen: any[] = [];
            let seen: { profile: any, lastInteraction: number }[] = [];
            let unseenLikers: any[] = [];

            const incomingDocs = await getDocs(query(collection(db, 'interactions'), where('to_user_id', '==', telegramId)));
            const likers = new Set();
            incomingDocs.forEach(d => { if (d.data().type === 'like' && !interactedMap.has(d.data().from_user_id)) likers.add(d.data().from_user_id); });

            const searchQuery = ctx.session?.currentSearchQuery ? ctx.session.currentSearchQuery.toLowerCase() : null;

            for (const cDoc of candidates.docs) {
                const b = cDoc.data();
                if (b.telegram_id === telegramId || b.banned) continue;
                
                // СТРОГИЙ ФИЛЬТР ПО ВОЗРАСТУ ±2 ГОДА (отменяем для тех, кто нас уже лайкнул)
                const isLiker = likers.has(b.telegram_id);
                if (!isLiker && Math.abs(myProfile.age - b.age) > 2) continue;

                // Gender match filter
                if (b.target_gender !== 'target_any') {
                    const theirSearchGender = b.target_gender === 'target_m' ? 'gender_m' : 'gender_f';
                    if (theirSearchGender !== myProfile.gender) continue;
                }

                if (searchQuery && (!b.bio || !b.bio.toLowerCase().includes(searchQuery))) continue;
                
                if (interactedMap.has(b.telegram_id)) {
                    seen.push({ profile: b, lastInteraction: interactedMap.get(b.telegram_id) });
                } else {
                    if (likers.has(b.telegram_id)) unseenLikers.push(b);
                    else unseen.push(b);
                }
            }
            
            // SMART SCORING ALGORITHM WITH PREMIUM BOOST & SHADOWBANS
            const calculateMatchScore = (me: any, cand: any) => {
                let score = 0;
                const ageDiff = Math.abs(me.age - cand.age);
                if (ageDiff <= 2) score += 50;
                else if (ageDiff <= 5) score += 20;
                else if (ageDiff <= 10) score += 5;
                
                if (me.city && cand.city && me.city.trim().toLowerCase() === cand.city.trim().toLowerCase()) score += 40;
                if (me.bio && cand.bio) {
                    const getWords = (t: string) => t.toLowerCase().replace(/[^а-яёa-z0-9]/gi, ' ').split(/\s+/).filter(w => w.length > 3);
                    const myWords = new Set(getWords(me.bio));
                    let overlap = 0;
                    getWords(cand.bio).forEach(w => { if (myWords.has(w)) overlap++; });
                    score += (overlap * 5);
                }
                
                // VIP / Premium priority boost!
                if (cand.is_premium) score += 150; 
                if (cand.shadowbanned) score -= 10000;
                
                score += Math.random() * 5;
                return score;
            };

            let candidateToShow = null;
            if (ctx.session?.view_likes_mode) {
                if (unseenLikers.length > 0) {
                    candidateToShow = unseenLikers[0];
                } else {
                    ctx.session.view_likes_mode = false;
                    await ctx.reply('💌 <b>Текущие симпатии закончились!</b>\nВозвращаю вас в общую ленту...', { parse_mode: 'HTML' });
                    if (unseen.length > 0) {
                        unseen.sort((a, b) => calculateMatchScore(myProfile, b) - calculateMatchScore(myProfile, a));
                        candidateToShow = unseen[0];
                    }
                }
            } else {
                if (unseen.length > 0) {
                    unseen.sort((a, b) => calculateMatchScore(myProfile, b) - calculateMatchScore(myProfile, a));
                    candidateToShow = unseen[0];
                } else if (seen.length > 0) {
                    seen.sort((a, b) => a.lastInteraction - b.lastInteraction);
                    candidateToShow = seen[0].profile;
                }
            }
            
            if (!candidateToShow) {
                if (searchQuery) return ctx.reply(`<b>Нет анкет со словом:</b> <i>${searchQuery}</i> 🏜️\n\nНажми /search, чтобы сбросить фильтр!`, { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } });
                return ctx.reply('<b>Пока что никого больше нет!</b> 🏜️\nЗагляни чуть позже.', { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } });
            }
            
            const header = searchQuery ? `🎯 ✨ <b>Фильтр:</b> <i>«${searchQuery}»</i>\n\n` : '';
            const caption = header + formatCard(candidateToShow);
            
            const kbd = Markup.keyboard([
                ['❤️', '💌', '👎', '💤']
            ]).resize();
            
            if (!ctx.session) ctx.session = {};
            ctx.session.candidate_id = candidateToShow.telegram_id;
            
            await sendMedia(ctx, candidateToShow, caption, kbd.reply_markup);
            
        } catch (err) { console.error(err); ctx.reply('Ошибка поиска. Попробуйте еще раз.', { reply_markup: { remove_keyboard: true } }); }
    }

    const getCandidateLog = (ctx: any) => {
        const cid = ctx.session?.candidate_id;
        if (ctx.session) ctx.session.candidate_id = null;
        
        // As requested: the candidate profiles and user interactions (like emojis) stay in the chat history.
        return cid;
    }

    bot.hears('❤️', async (ctx: any) => {
        const toUserId = getCandidateLog(ctx);
        if (!toUserId) return;
        const fromUserId = String(ctx.from?.id);
        const myDDoc = await getDoc(doc(db, 'users', fromUserId));
        if(!myDDoc.exists()) return;
        
        await setDoc(doc(db, 'interactions', `${fromUserId}_${toUserId}`), { from_user_id: fromUserId, to_user_id: toUserId, type: 'like', created_at: serverTimestamp() });
        const incomingSnap = await getDoc(doc(db, 'interactions', `${toUserId}_${fromUserId}`));
        if (incomingSnap.exists() && incomingSnap.data().type === 'like') {
            await handleMatch(ctx, fromUserId, toUserId, myDDoc.data()!);
        } else {
            await notifyIncomingLike(toUserId);
        }
        await showNextProfile(ctx, fromUserId);
    });

    bot.hears('👎', async (ctx: any) => {
        const toUserId = getCandidateLog(ctx);
        if (!toUserId) return;
        const fromUserId = String(ctx.from?.id);
        await setDoc(doc(db, 'interactions', `${fromUserId}_${toUserId}`), { from_user_id: fromUserId, to_user_id: toUserId, type: 'dislike', created_at: serverTimestamp() });
        await showNextProfile(ctx, fromUserId);
    });

    bot.hears('💌', async (ctx: any) => {
        const toUserId = getCandidateLog(ctx);
        if (!toUserId) return;
        const fromUserId = String(ctx.from?.id);
        try {
            const userRef = doc(db, 'users', fromUserId);
            const snap = await getDoc(userRef);
            if (!snap.exists()) return;
            const d = snap.data();
            
            const now = Date.now();
            let used = d.sl_used_today || 0;
            let resetTime = d.sl_reset_time || 0;
            
            if (now > resetTime) {
                used = 0;
                resetTime = now + 24 * 60 * 60 * 1000;
            }
            
            if (used < 2) {
                used += 1;
                await setDoc(userRef, { sl_used_today: used, sl_reset_time: resetTime }, { merge: true });
                await ctx.reply(`🌟 Суперлайк доставлен! (Осталось бесплатных: ${2 - used})`).then((m:any) => setTimeout(()=>del(ctx, m.message_id), 3000));
                await sendSuperLikeLogic(ctx, fromUserId, toUserId);
                await showNextProfile(ctx, fromUserId);
            } else {
                await ctx.replyWithInvoice({
                    title: 'Суперлайк 🌟',
                    description: 'Твои 2 бесплатных суперлайка на сегодня закончились. Отправь суперлайк прямо сейчас за Telegram Звезды!',
                    payload: `SL_${toUserId}`,
                    provider_token: '', 
                    currency: 'XTR',
                    prices: [{ label: '1 Суперлайк', amount: 10 }]
                });
            }
        } catch(e) {}
    });

    const handleSleepMenu = async (ctx: any) => {
        if (ctx.message) await del(ctx, ctx.message.message_id).catch(()=>{});
        if (!ctx.session) ctx.session = {};
        ctx.session.in_sleep_menu = true;
        
        const text = `Подождем пока кто-то увидит твою анкету\n\n1. Смотреть анкеты.\n2. Моя анкета.\n3. Я больше не хочу никого искать.\n***\n4. Активируй Premium — будь в топе ⭐`;
        const kbd = Markup.keyboard([
            ['1', '2', '3'],
            ['4']
        ]).resize();
        
        await ctx.reply(text, { parse_mode: 'HTML', ...kbd });
    };

    bot.hears('💤', handleSleepMenu);
    bot.command('sleep', handleSleepMenu);

    bot.hears('Лента', async (ctx: any) => {
        if (ctx.session) ctx.session.currentSearchQuery = null; 
        await showNextProfile(ctx, String(ctx.from.id));
    });
    bot.command('search', async (ctx: any) => {
        if (ctx.message) await del(ctx, ctx.message.message_id).catch(()=>{});
        if (ctx.session) ctx.session.currentSearchQuery = null;
        await showNextProfile(ctx, String(ctx.from?.id));
    });

    bot.command('find', async (ctx: any) => {
        if (ctx.message) await del(ctx, ctx.message.message_id).catch(()=>{});
        ctx.scene.enter('interest-wizard');
    });

    const isSuperAdmin = (ctx: any) => {
        const uid = String(ctx.from?.id);
        const uname = ctx.from?.username ? `@${ctx.from.username}`.toLowerCase() : '';
        const adminEnv = (process.env.ADMIN_ID || '').toLowerCase();
        
        return uname === 'vnezdv' || uname === '@vnezdv' || uid === adminEnv || uname === adminEnv;
    };

    bot.command('admin', async (ctx: any) => {
        const uid = String(ctx.from.id);
        const confDoc = await getDoc(doc(db, 'config', 'system'));
        let admins = confDoc.exists() && confDoc.data().admins ? confDoc.data().admins : [];

        if (isSuperAdmin(ctx) || admins.includes(uid)) {
            if (!admins.includes(uid)) {
                admins.push(uid);
                await setDoc(doc(db, 'config', 'system'), { admins }, { merge: true });
            }
            await ctx.reply('✅ Доступ подтвержден! Панель модератора активна. Вы будете получать жалобы в этот чат.');
        } else {
            await ctx.reply('⛔ Отказано в доступе.');
        }
    });

    bot.command('add_admin', async (ctx: any) => {
        if (!isSuperAdmin(ctx)) return ctx.reply('⛔ У вас нет прав (только Создатель может добавлять администраторов).');
        const args = ctx.message.text.split(' ');
        if (args.length < 2) return ctx.reply('Использование: /add_admin <telegram_id>');
        
        const newAdminId = args[1];
        const confDoc = await getDoc(doc(db, 'config', 'system'));
        let admins = confDoc.exists() && confDoc.data().admins ? confDoc.data().admins : [];
        if (!admins.includes(newAdminId)) {
            admins.push(newAdminId);
            await setDoc(doc(db, 'config', 'system'), { admins }, { merge: true });
            await ctx.reply(`✅ ID ${newAdminId} назначен модератором. Теперь он имеет доступ к команде /admin и получению жалоб.`);
        } else {
            await ctx.reply('Этот пользователь уже является модератором.');
        }
    });

    bot.command('remove_admin', async (ctx: any) => {
        if (!isSuperAdmin(ctx)) return ctx.reply('⛔ Отказано в доступе.');
        const args = ctx.message.text.split(' ');
        if (args.length < 2) return ctx.reply('Использование: /remove_admin <telegram_id>');
        
        const remAdminId = args[1];
        const confDoc = await getDoc(doc(db, 'config', 'system'));
        let admins = confDoc.exists() && confDoc.data().admins ? confDoc.data().admins : [];
        if (admins.includes(remAdminId)) {
            admins = admins.filter((id: string) => id !== remAdminId);
            await setDoc(doc(db, 'config', 'system'), { admins }, { merge: true });
            await ctx.reply(`❌ ID ${remAdminId} удален из модераторов.`);
        } else {
            await ctx.reply('Этот пользователь не был модератором.');
        }
    });

    bot.command('stats', async (ctx: any) => {
        const uid = String(ctx.from.id);
        const confDoc = await getDoc(doc(db, 'config', 'system'));
        const admins = confDoc.exists() && confDoc.data().admins ? confDoc.data().admins : [];

        if (!isSuperAdmin(ctx) && !admins.includes(uid)) {
            return ctx.reply('⛔ Отказано в доступе. Команда только для администрации.');
        }

        const waitMsg = await ctx.reply('⏳ Собираю подробную статистику...');
        
        try {
            const totalUsersSnap = await getCountFromServer(collection(db, 'users'));
            const activeUsersSnap = await getCountFromServer(query(collection(db, 'users'), where('active', '==', true)));
            const premiumUsersSnap = await getCountFromServer(query(collection(db, 'users'), where('is_premium', '==', true)));
            const boysSnap = await getCountFromServer(query(collection(db, 'users'), where('gender', '==', 'gender_m')));
            const girlsSnap = await getCountFromServer(query(collection(db, 'users'), where('gender', '==', 'gender_f')));

            const text = `📊 <b>Подробная статистика</b>\n\n` +
                         `👥 <b>Всего юзеров:</b> ${totalUsersSnap.data().count}\n` +
                         `🙎‍♂️ <b>Парней:</b> ${boysSnap.data().count} | 🙎‍♀️ <b>Девушек:</b> ${girlsSnap.data().count}\n` +
                         `🔥 <b>В активном поиске:</b> ${activeUsersSnap.data().count}\n` +
                         `💎 <b>VIP статусов:</b> ${premiumUsersSnap.data().count}`;

            await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, null, text, { parse_mode: 'HTML' });
        } catch (e) {
            console.error(e);
            await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, null, '❌ Ошибка при получении статистики.');
        }
    });

    // MASS MESSAGE TO ALL USERS (BROADCAST)
    bot.command('broadcast', async (ctx: any) => {
        const uid = String(ctx.from.id);
        const confDoc = await getDoc(doc(db, 'config', 'system'));
        const admins = confDoc.exists() && confDoc.data().admins ? confDoc.data().admins : [];

        if (!isSuperAdmin(ctx) && !admins.includes(uid)) {
            return ctx.reply('⛔ Отказано в доступе.');
        }

        const messageText = ctx.message.text.substring(10).trim();
        if (!messageText) {
            return ctx.reply('⚠️ Использование: <code>/broadcast ВАШ_ТЕКСТ</code>\nПример: /broadcast Привет, у нас обновление!', { parse_mode: 'HTML' });
        }

        const waitMsg = await ctx.reply('⏳ Отправляю рассылку всем пользователям... Пожалуйста, не спамьте эту команду.');

        try {
            const usersQuery = await getDocs(collection(db, 'users'));
            let successCount = 0;
            let failCount = 0;

            for (const uDoc of usersQuery.docs) {
                const tgId = uDoc.data().telegram_id;
                if (!tgId) continue;
                try {
                    await bot.telegram.sendMessage(tgId, `📣 <b>Сообщение от администрации:</b>\n\n${messageText}`, { parse_mode: 'HTML' });
                    successCount++;
                } catch (err: any) {
                    failCount++; // Юзер заблокировал бота
                }
            }

            await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, null, `✅ <b>Рассылка завершена!</b>\n\nУспешно отправлено: ${successCount}\nНе удалось (ботов/блоков): ${failCount}`, { parse_mode: 'HTML' });
        } catch (e) {
            console.error('Broadcast err:', e);
            await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, null, '❌ Произошла ошибка во время рассылки.');
        }
    });


    // ----------------------------------------
    // INTERACTIONS (LIKE / DISLIKE / SUPERLIKE )
    // ----------------------------------------
    async function notifyIncomingLike(toUserId: string) {
        try {
            const incoming = await getDocs(query(collection(db, 'interactions'), where('to_user_id', '==', toUserId)));
            const outgoing = await getDocs(query(collection(db, 'interactions'), where('from_user_id', '==', toUserId)));
            
            const outSet = new Set();
            outgoing.forEach(d => outSet.add(d.data().to_user_id));
            
            let pending = 0;
            incoming.forEach(d => {
                if (d.data().type === 'like' && !outSet.has(d.data().from_user_id)) {
                    pending++;
                }
            });

            const uDoc = await getDoc(doc(db, 'users', toUserId));
            if (!uDoc.exists()) return;
            const uData = uDoc.data();

            if (pending > 0) {
                const text = `💌 <b>У вас ${pending} ${pending === 1 ? 'новая симпатия' : 'скрытых симпатий'}!</b>\nХотите посмотреть, кому вы понравились?`;
                const kbd = Markup.inlineKeyboard([[{ text: '👀 Посмотреть', callback_data: 'view_likes' }]]);
                
                // delete old notification
                if (uData.likes_msg_id) {
                    try { await bot!.telegram.deleteMessage(toUserId, uData.likes_msg_id); } catch(e){}
                }
                
                const sent = await bot!.telegram.sendMessage(toUserId, text, { parse_mode: 'HTML', ...kbd });
                await setDoc(doc(db, 'users', toUserId), { likes_msg_id: sent.message_id }, { merge: true });
            }
        } catch(e) { console.error('notify err', e); }
    }

    bot.action(/^like_(.+)$/, async (ctx: any) => {
        const toUserId = ctx.match[1];
        const fromUserId = String(ctx.from?.id);
        try {
            await setDoc(doc(db, 'interactions', `${fromUserId}_${toUserId}`), { from_user_id: fromUserId, to_user_id: toUserId, type: 'like', created_at: serverTimestamp() });
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});
            
            const matchDoc = await getDoc(doc(db, 'interactions', `${toUserId}_${fromUserId}`));
            if (matchDoc.exists() && matchDoc.data()?.type === 'like') {
                const myD = (await getDoc(doc(db, 'users', fromUserId))).data()!;
                const otherD = (await getDoc(doc(db, 'users', toUserId))).data()!;
                const myUrl = myD.username ? `https://t.me/${myD.username}` : `tg://user?id=${fromUserId}`;
                const otherUrl = otherD.username ? `https://t.me/${otherD.username}` : `tg://user?id=${toUserId}`;
                
                ctx.answerCbQuery('ИТС Э МЭТЧ! 🥳', { showAlert: true });
                
                const matchKbdYou = Markup.inlineKeyboard([[{ text: `✈️ Написать ${otherD.name}`, url: otherUrl }]]);
                await sendMedia(ctx, otherD, `🎉 <b>Взаимная симпатия!</b> 🎉\n\nВы с <b>${otherD.name}</b> понравились друг другу.\nНе теряй время, жми кнопку и пиши! 🔥`, matchKbdYou.reply_markup);
                
                const matchKbdThem = Markup.inlineKeyboard([[{ text: `✈️ Написать ${myD.name}`, url: myUrl }]]);
                const sendMethod = myD.media_type === 'video' ? bot.telegram.sendVideo.bind(bot.telegram) : (myD.media_type === 'animation' ? bot.telegram.sendAnimation.bind(bot.telegram) : bot.telegram.sendPhoto.bind(bot.telegram));
                const mediaId = myD.media_id || myD.photo_url;
                
                await sendMethod(toUserId, mediaId, { caption: `🎉 <b>Взаимная симпатия!</b> 🎉\n\nТы понравился(ась) <b>${myD.name}</b>.\nСкорее пиши первым(ой)! 🔥`, reply_markup: matchKbdThem.reply_markup as any, parse_mode: 'HTML' }).catch(()=>{});
            } else {
                ctx.answerCbQuery('Лайк отправлен 💖');
                await notifyIncomingLike(toUserId);
            }
            await showNextProfile(ctx, fromUserId);
        } catch (err) { ctx.answerCbQuery('Ошибка'); }
    });

    async function sendSuperLikeLogic(ctx: any, fromUserId: string, toUserId: string) {
        await setDoc(doc(db, 'interactions', `${fromUserId}_${toUserId}`), { from_user_id: fromUserId, to_user_id: toUserId, type: 'like', is_superlike: true, created_at: serverTimestamp() });

        const myDDoc = await getDoc(doc(db, 'users', fromUserId));
        if(!myDDoc.exists()) return;
        const myD = myDDoc.data()!;
        
        const sendMethod = myD.media_type === 'video' ? bot.telegram.sendVideo.bind(bot.telegram) : (myD.media_type === 'animation' ? bot.telegram.sendAnimation.bind(bot.telegram) : bot.telegram.sendPhoto.bind(bot.telegram));
        const mediaId = myD.media_id || myD.photo_url;
        
        const sl_kbd = Markup.inlineKeyboard([
            [ { text: '❌ Дальше', callback_data: `dislike_${fromUserId}` }, { text: '❤️ Ответить', callback_data: `like_${fromUserId}` } ]
        ]);
        
        await sendMethod(toUserId, mediaId, { 
            caption: `🌟 <b>ТЕБЕ ОТПРАВИЛИ СУПЕРЛАЙК!</b> 🌟\nКто-то очень хочет пообщаться!\n\n${formatCard(myD)}`, 
            reply_markup: sl_kbd.reply_markup as any, 
            parse_mode: 'HTML' 
        }).catch(() => {});
    }

    bot.action(/^superlike_(.+)$/, async (ctx: any) => {
        const toUserId = ctx.match[1];
        const fromUserId = String(ctx.from?.id);
        
        try {
            const userRef = doc(db, 'users', fromUserId);
            const snap = await getDoc(userRef);
            if (!snap.exists()) return;
            const d = snap.data();
            
            const now = Date.now();
            let used = d.sl_used_today || 0;
            let resetTime = d.sl_reset_time || 0;
            
            if (now > resetTime) {
                used = 0;
                resetTime = now + 24 * 60 * 60 * 1000;
            }
            
            if (used < 2) {
                used += 1;
                await setDoc(userRef, { sl_used_today: used, sl_reset_time: resetTime }, { merge: true });
                await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});
                ctx.answerCbQuery(`🌟 Суперлайк доставлен! (Осталось бесплатных: ${2 - used})`, { showAlert: true });

                await sendSuperLikeLogic(ctx, fromUserId, toUserId);
                await showNextProfile(ctx, fromUserId);
            } else {
                ctx.answerCbQuery('Бесплатные закончились. Купите за звезды!');
                await ctx.replyWithInvoice({
                    title: 'Суперлайк 🌟',
                    description: 'Твои 2 бесплатных суперлайка на сегодня закончились. Отправь суперлайк прямо сейчас за Telegram Звезды!',
                    payload: `SL_${toUserId}`,
                    provider_token: '', 
                    currency: 'XTR',
                    prices: [{ label: '1 Суперлайк', amount: 10 }]
                });
            }
        } catch(e) { ctx.answerCbQuery('Ошибка'); }
    });

    bot.action(/^dislike_(.+)$/, async (ctx: any) => {
        const toUserId = ctx.match[1];
        const fromUserId = String(ctx.from?.id);
        try {
            await setDoc(doc(db, 'interactions', `${fromUserId}_${toUserId}`), { from_user_id: fromUserId, to_user_id: toUserId, type: 'dislike', created_at: serverTimestamp() });
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});
            ctx.answerCbQuery('Пропускаем 💨');
            await showNextProfile(ctx, fromUserId);
        } catch (err) { ctx.answerCbQuery('Ошибка'); }
    });

    // ----------------------------------------
    // PAYMENTS AND PREMIUM SYSTEM
    // ----------------------------------------
    bot.action('buy_premium', async (ctx: any) => {
        await ctx.answerCbQuery();
        await ctx.replyWithInvoice({
            title: '💎 Premium-буст',
            description: 'Получай в 3 раза больше просмотров анкеты! Твоя анкета будет показываться намного чаще другим пользователям.',
            payload: `PREMIUM_PAY`,
            provider_token: '', 
            currency: 'XTR',
            prices: [{ label: 'Буст анкеты', amount: 50 }]
        });
    });

    bot.on('pre_checkout_query', async (ctx: any) => {
        await ctx.answerPreCheckoutQuery(true).catch(console.error);
    });

    bot.on('successful_payment', async (ctx: any) => {
        const payload = ctx.message.successful_payment.invoice_payload;
        const fromUserId = String(ctx.from?.id);

        if (payload && payload.startsWith('SL_')) {
            const toUserId = payload.replace('SL_', '');
            await ctx.reply('⭐️ Оплата прошла успешно! Ваш суперлайк отправлен.', { reply_markup: { remove_keyboard: true } });
            await sendSuperLikeLogic(ctx, fromUserId, toUserId);
            await showNextProfile(ctx, fromUserId);
        } else if (payload === 'PREMIUM_PAY') {
            await setDoc(doc(db, 'users', fromUserId), { is_premium: true }, { merge: true });
            await ctx.reply('💎 <b>Premium-буст активирован!</b>\nТеперь вашу анкету увидит гораздо больше людей.', { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } });
        }
    });

    // ----------------------------------------
    // REPORTING SYSTEM (COMPLAINTS)
    // ----------------------------------------
    bot.action(/^reportP_(.+)$/, async (ctx: any) => {
        // Obsolete action, complain is now via /complaint command
        await ctx.answerCbQuery('Используй команду /complaint в меню!');
    });

    bot.action(/^repCancel_(.+)$/, async (ctx: any) => {
        await ctx.answerCbQuery();
        if (ctx.callbackQuery.message) await del(ctx, ctx.callbackQuery.message.message_id);
    });

    bot.action(/^repR_([1-4])_(.+)$/, async (ctx: any) => {
        const reasonId = ctx.match[1];
        const targetId = ctx.match[2];
        const fromId = String(ctx.from?.id);
        
        const reasons: any = { '1': '🔞 Материал для взрослых', '2': '💰 Продажа товаров и услуг', '3': '💩 Спам/Мошенничество', '4': '🦨 Другое' };
        
        await ctx.answerCbQuery('Жалоба отправлена модераторам. Спасибо!', { showAlert: true });
        if (ctx.callbackQuery.message) await del(ctx, ctx.callbackQuery.message.message_id);
        
        try {
            const reporterDoc = await getDoc(doc(db, 'users', fromId));
            const targetDoc = await getDoc(doc(db, 'users', targetId));
            if(reporterDoc.exists() && targetDoc.exists()) {
                const repMsg = `🚨 <b>НОВАЯ ЖАЛОБА</b> 🚨\n\n<b>Жалоба на:</b> ${targetDoc.data().name} (ID: <code>${targetId}</code>)\n<b>Причина:</b> ${reasons[reasonId]}\n<b>От кого:</b> ${reporterDoc.data().name} (ID: <code>${fromId}</code>)\n\n<b>Анкета нарушителя:</b>\n${targetDoc.data().bio}`;
                
                const adminKbd = Markup.inlineKeyboard([
                    [Markup.button.callback('⛔ ЗАБЛОКИРОВАТЬ', `admBan_${targetId}`)],
                    [Markup.button.callback('👻 Теневой бан (Снизить рейтинг)', `admShadow_${targetId}`)],
                    [Markup.button.callback('✅ Отклонить', `admOk_0`)]
                ]);
                
                try {
                    const confDoc = await getDoc(doc(db, 'config', 'system'));
                    let admins = confDoc.exists() && confDoc.data().admins ? confDoc.data().admins : [];
                    
                    if (admins.length === 0) {
                        const q = query(collection(db, 'users'), where('username', '==', 'vNEZDv'));
                        const snaps = await getDocs(q);
                        if (!snaps.empty) {
                            admins = [snaps.docs[0].data().telegram_id];
                        }
                    }
                    
                    if (admins.length > 0) {
                        for (const adminId of admins) {
                            bot.telegram.sendMessage(adminId, repMsg, { parse_mode: 'HTML', ...adminKbd }).catch(()=>{});
                        }
                    } else {
                        console.error('Не удалось найти ID администратора.');
                    }
                } catch(e) { console.error("Failed to prompt admin:", e); }
            }
        } catch(e) { console.error('Error reporting logic', e); }

        if (ctx.session) ctx.session.candidate_id = null;
        await showNextProfile(ctx, fromId);
    });

    // ADMIN ACTIONS
    const checkIsAdminAction = async (ctx: any): Promise<boolean> => {
        if (isSuperAdmin(ctx)) return true;
        const confDoc = await getDoc(doc(db, 'config', 'system'));
        const admins = confDoc.exists() && confDoc.data().admins ? confDoc.data().admins : [];
        if (admins.includes(String(ctx.from.id))) return true;
        await ctx.answerCbQuery('У вас нет прав!', { showAlert: true });
        return false;
    };

    bot.action(/^admBan_(.+)$/, async (ctx: any) => {
        if (!(await checkIsAdminAction(ctx))) return;
        const targetId = ctx.match[1];
        await setDoc(doc(db, 'users', targetId), { active: false, banned: true }, { merge: true });
        await ctx.answerCbQuery('Пользователь заблокирован навсегда!');
        await ctx.editMessageText('✅ Модерация:\n⛔ ПОЛЬЗОВАТЕЛЬ ЗАБЛОКИРОВАН').catch(()=>{});
    });
    bot.action(/^admShadow_(.+)$/, async (ctx: any) => {
        if (!(await checkIsAdminAction(ctx))) return;
        const targetId = ctx.match[1];
        await setDoc(doc(db, 'users', targetId), { shadowbanned: true }, { merge: true });
        await ctx.answerCbQuery('Теневой бан активирован!');
        await ctx.editMessageText('✅ Модерация:\n👻 ВЫДАН ТЕНЕВОЙ БАН').catch(()=>{});
    });
    bot.action('admOk_0', async (ctx: any) => {
        if (!(await checkIsAdminAction(ctx))) return;
        await ctx.answerCbQuery('Отклонено');
        await ctx.editMessageText('✅ Модерация:\nЖАЛОБА ОТКЛОНЕНА').catch(()=>{});
    });

    // ----------------------------------------
    // AUTO-RECOVERY (FALLBACK HANDLERS)
    // ----------------------------------------
    // Если пользователь нажал на старую кнопку, которая уже не обрабатывается ни одним bot.action
    bot.on('callback_query', async (ctx: any) => {
        await ctx.answerCbQuery('🔄 Меню обновлено!', { show_alert: false }).catch(()=>{});
        if (ctx.scene) await ctx.scene.leave().catch(()=>{});
        await ctx.reply('🔄 <b>Бот был переведен на новую версию.</b>\nСвязь восстановлена, выберите действие в меню /myprofile или /search 👇', { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } }).catch(()=>{});
    });

    // Если пользователь отправил текст/медиа вне сцены и не попал ни в одну кнопку (бот перезагрузился и т.д.)
    bot.on('message', async (ctx: any) => {
        if (ctx.scene) await ctx.scene.leave().catch(()=>{});
        await ctx.reply('🔄 <b>Я всегда на связи!</b>\nЕсли что-то зависло, я автоматически обновил сессию.\n\nЖми /search или /myprofile 👇', { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } }).catch(()=>{});
    });

    // Инициализация Webhooks или Long Polling
    const webhookDomain = process.env.WEBHOOK_DOMAIN;

    if (webhookDomain) {
        try {
            console.log(`Configuring Webhook for: ${webhookDomain}/telegraf`);
            await bot.telegram.deleteWebhook({ drop_pending_updates: true });
            
            // Важно: Telegraf сам парсит JSON, если использовать его как middleware
            expressApp.use(bot.webhookCallback('/telegraf'));
            
            // Настроим дополнительный эндпоинт для проверки здоровья сервера (чтобы мы могли зайти на сайт и проверить работает ли код)
            expressApp.get('/', (req, res) => {
                res.send('Бот запущен и работает! Webhooks активны.');
            });

            await bot.telegram.setWebhook(`${webhookDomain}/telegraf`, { drop_pending_updates: true });
            console.log(`🚀 Bot is running in Webhook mode!`);
        } catch (e) {
            console.error("Webhook Setup Error:", e);
        }
    } else {
        // Запуск через Long Polling
        try {
            await bot.telegram.deleteWebhook({ drop_pending_updates: true });
            bot.launch();
            console.log('🚀 Bot is running in Long Polling mode...');
        } catch (e: any) {
            if (e.response && e.response.error_code === 409) {
                console.error('⛔ СONFLICT: Another instance of the bot is already running. Please stop it or use Webhooks.');
            } else {
                console.error("Long Polling Error:", e);
            }
        }
    }

    const port = process.env.PORT || 3000;
    expressApp.listen(port, '0.0.0.0', () => {
        console.log(`🌐 HTTP Server listening on port ${port}`);
    });

    process.once('SIGINT', () => { bot.stop('SIGINT') });
    process.once('SIGTERM', () => { bot.stop('SIGTERM') });
    console.log('Bot is heavily optimized with Premium Subscriptions and Admin Reporting...');
}
