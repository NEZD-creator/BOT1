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
        const premiumBadge = d.is_premium ? ' 💎 VIP' : '';
        return `<b>${d.name}, ${d.age}</b>${premiumBadge}\n🏙 <i>${d.city}</i>\n━━━━━━━━━━━━━━\n📝 ${d.bio}`;
    };

    const mainMenu = Markup.keyboard([
        ['🔥 Лента', '🔍 Умный поиск'],
        ['🎁 Привести друга (VIP)', '⚙️ Общее Меню']
    ]).resize();

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
        
        const msg = await ctx.reply('<b>Шаг 1/7</b>\nДобро пожаловать в создание анкеты.\n\nУкажи свой пол:', { parse_mode: 'HTML', ...Markup.inlineKeyboard(kbd) });
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
        
        const msg = await ctx.reply('<b>Шаг 2/7</b>\nКого будем искать? 👀', { parse_mode: 'HTML', ...Markup.inlineKeyboard(kbd) });
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
        
        const msg = await ctx.reply('<b>Шаг 3/7</b>\nТвое имя (или ник)? ✍️', { parse_mode: 'HTML', ...kbd });
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
        
        const msg = await ctx.reply('<b>Шаг 4/7</b>\nСколько тебе лет? (цифрами) 🎂', { parse_mode: 'HTML', ...kbd });
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
        
        const msg = await ctx.reply('<b>Шаг 5/7</b>\nИз какого ты города? 🌆', { parse_mode: 'HTML', ...kbd });
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
        const msg = await ctx.reply('<b>Шаг 6/7</b>\nРасскажи о себе и своих увлечениях 🎵🎮\n<i>(Алгоритм использует этот текст, чтобы находить людей с общими интересами)</i>', { parse_mode: 'HTML', ...kbd });
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
            
        const msg = await ctx.reply('<b>Финальный шаг 7/7!</b> 📸\nПрикрепи свое классное фото или видео-кружок (до 15 сек).', { parse_mode: 'HTML', ...kbd });
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
                const m = await ctx.reply('Видео слишком длинное! Нужно до 15 сек.');
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
            await ctx.reply('🎉 <b>Анкета успешно сохранена!</b>', { parse_mode: 'HTML', ...mainMenu });
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
                
                await ctx.reply(`🎯 Ищем анкеты со словом: <b>${querytext}</b>...\n<i>(Для сброса фильтра нажми "🔥 Лента" в меню)</i>`, { parse_mode: 'HTML', ...mainMenu });
                await showNextProfile(ctx, String(ctx.from.id));
            }
            return ctx.scene.leave();
        }
    );

    const stage = new Stage([profileWizard, interestWizard]);
    
    bot.catch(async (err: any, ctx: any) => {
        console.error("Bot Global Error:", err);
        try {
            if (ctx.callbackQuery) {
                await ctx.answerCbQuery('🔄 Идет обновление бота...', { show_alert: false }).catch(()=>{});
            }
            if (ctx.scene) await ctx.scene.leave().catch(()=>{});
            await ctx.reply('🔄 <b>Бот был обновлен.</b>\nСессия восстановлена, продолжаем работу! 👇', { parse_mode: 'HTML', ...mainMenu }).catch(()=>{});
        } catch(e) {
            console.error("Recovery failed", e);
        }
    });

    bot.use(session());
    bot.use(stage.middleware() as any);

    bot.start(async (ctx: any) => {
        const uid = String(ctx.from?.id);
        const refDoc = doc(db, 'users', uid);
        const userDoc = await getDoc(refDoc);
        
        // В Telegraf payload стартовой команды можно получить через ctx.payload или распарсив команду:
        const payload = ctx.payload || (ctx.message?.text?.split(' ')[1]);

        if (userDoc.exists()) {
            if (userDoc.data().banned) return ctx.reply('⛔ <b>Ваш аккаунт заблокирован.</b>', { parse_mode: 'HTML' });
            await ctx.reply('<b>С возвращением!</b> Нажимай «🔥 Лента», чтобы продолжить поиск! 💘', { parse_mode: 'HTML', ...mainMenu });
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

            await ctx.reply('<b>Привет! Бот-Дейтинг на связи.</b> 💘\nТут можно найти классную компанию, вторую половину или новых друзей.\n\nЖми кнопку ниже, чтобы заполнить анкету!', 
                { parse_mode: 'HTML', ...Markup.inlineKeyboard([[{ text: '📝 Создать профиль', callback_data: 'edit_profile' }]]) }
            );
        }
    });

    // ----------------------------------------
    // MAIN MENU & MY PROFILE UI
    // ----------------------------------------
    bot.hears('⚙️ Общее Меню', async (ctx: any) => {
        const uid = String(ctx.from.id);
        const userDoc = await getDoc(doc(db, 'users', uid));
        const d = userDoc.exists() ? userDoc.data() : null;
        
        let text = '⚙️ <b>Главное меню</b>\n\nЗдесь вы можете настроить свой профиль или приобрести VIP.';
        let premBtnText = '💎 Купить Premium-буст';

        if (d && d.is_premium) {
            text += '\n\n💎 <b>У вас активен Premium-статус!</b>\nВаша анкета получает больше показов и находится выше в Ленте.';
            premBtnText = '💎 Продлить Premium';
        }

        const kbd = Markup.inlineKeyboard([
            [{ text: '👤 Моя Анкета (Редактировать)', callback_data: 'my_profile' }],
            [{ text: premBtnText, callback_data: 'buy_premium' }]
        ]);

        await ctx.reply(text, { parse_mode: 'HTML', ...kbd });
    });

    bot.action('my_profile', async (ctx: any) => {
        await ctx.answerCbQuery();
        await showMyProfile(ctx, String(ctx.from.id));
    });

    async function showMyProfile(ctx: any, telegramId: string) {
        if (ctx.session?.myProfileMsgId) {
            await del(ctx, ctx.session.myProfileMsgId);
        }
        
        const userDoc = await getDoc(doc(db, 'users', telegramId));
        if (!userDoc.exists()) return ctx.reply('У тебя еще нет профиля!', Markup.inlineKeyboard([[{ text: '📝 Создать анкету', callback_data: 'edit_profile' }]]));
        const d = userDoc.data()!;
        
        if (!d.media_id && d.photo_url) { d.media_id = d.photo_url; d.media_type = 'photo'; }
        
        const statusIndicator = d.active ? '<b>СТАТУС: АКТИВНА</b> (показывается в поиске)' : '<b>СТАТУС: СКРЫТА</b> (тебя никто не видит)';
        const caption = `${statusIndicator}\n\n${formatCard(d)}`;
        
        const kbd = Markup.inlineKeyboard([
            [{ text: '✏️ Изменить профиль', callback_data: 'edit_profile' }],
            [{ text: d.active ? '👁️‍🗨️ Скрыть анкету (Пауза)' : '🚀 Включить и искать', callback_data: 'toggle_active' }]
        ]);
        
        const sentMsg = await sendMedia(ctx, d, caption, kbd.reply_markup);
        if (sentMsg) {
            if (!ctx.session) ctx.session = {};
            ctx.session.myProfileMsgId = sentMsg.message_id;
        }
    }

    bot.action('edit_profile', async (ctx: any) => { 
        await ctx.answerCbQuery();
        if (ctx.callbackQuery.message) await del(ctx, ctx.callbackQuery.message.message_id); 
        ctx.scene.enter('profile-wizard'); 
    });
    bot.action('toggle_active', async (ctx: any) => {
        const uid = String(ctx.from.id);
        const ref = doc(db, 'users', uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
            const newState = !snap.data().active;
            await setDoc(ref, { active: newState }, { merge: true });
            ctx.answerCbQuery(newState ? 'Анкета включена! 🚀' : 'Анкета спрятана! 💤');
            await showMyProfile(ctx, uid);
        }
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
            if (!myProfile.active) return ctx.reply('<b>Упс!</b> Твоя анкета скрыта. 💤\nЗайди в меню, чтобы включить её.', { parse_mode: 'HTML', ...mainMenu });

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

            const searchQuery = ctx.session?.currentSearchQuery ? ctx.session.currentSearchQuery.toLowerCase() : null;

            for (const cDoc of candidates.docs) {
                const b = cDoc.data();
                if (b.telegram_id === telegramId || b.banned) continue;
                
                // Gender match filter
                if (b.target_gender !== 'target_any') {
                    const theirSearchGender = b.target_gender === 'target_m' ? 'gender_m' : 'gender_f';
                    if (theirSearchGender !== myProfile.gender) continue;
                }

                if (searchQuery && (!b.bio || !b.bio.toLowerCase().includes(searchQuery))) continue;
                
                if (interactedMap.has(b.telegram_id)) {
                    seen.push({ profile: b, lastInteraction: interactedMap.get(b.telegram_id) });
                } else {
                    unseen.push(b);
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
            if (unseen.length > 0) {
                unseen.sort((a, b) => calculateMatchScore(myProfile, b) - calculateMatchScore(myProfile, a));
                candidateToShow = unseen[0];
            } else if (seen.length > 0) {
                seen.sort((a, b) => a.lastInteraction - b.lastInteraction);
                candidateToShow = seen[0].profile;
            }
            
            if (!candidateToShow) {
                if (searchQuery) return ctx.reply(`<b>Нет анкет со словом:</b> <i>${searchQuery}</i> 🏜️\n\nНажми «🔥 Лента», чтобы смотреть всех!`, { parse_mode: 'HTML', ...mainMenu });
                return ctx.reply('<b>Пока что никого больше нет!</b> 🏜️\nЗагляни чуть позже.', { parse_mode: 'HTML', ...mainMenu });
            }
            
            const header = searchQuery ? `🎯 ✨ <b>Фильтр:</b> <i>«${searchQuery}»</i>\n\n` : '';
            const caption = header + formatCard(candidateToShow);
            
            const kbd = Markup.inlineKeyboard([
                [ 
                    { text: '❌ Дальше', callback_data: `dislike_${candidateToShow.telegram_id}` },
                    { text: '❤️ Лайк', callback_data: `like_${candidateToShow.telegram_id}` } 
                ],
                [ 
                    { text: '🌟 Суперлайк', callback_data: `superlike_${candidateToShow.telegram_id}` },
                    { text: '🚨', callback_data: `reportP_${candidateToShow.telegram_id}` }
                ]
            ]);
            
            await sendMedia(ctx, candidateToShow, caption, kbd.reply_markup);
            
        } catch (err) { console.error(err); ctx.reply('Ошибка поиска. Попробуйте еще раз.', mainMenu); }
    }

    bot.hears('🔥 Лента', async (ctx: any) => {
        if (ctx.session) ctx.session.currentSearchQuery = null; 
        await showNextProfile(ctx, String(ctx.from.id));
    });
    bot.hears('🔍 Умный поиск', async (ctx: any) => {
        ctx.scene.enter('interest-wizard');
    });
    bot.hears('🎁 Привести друга (VIP)', async (ctx: any) => {
        const myId = ctx.from.id;
        const botInfo = await bot.telegram.getMe();
        const botUsername = '@' + botInfo.username;
        const refLink = `https://t.me/${botInfo.username}?start=${myId}`;
        
        const header = `🎁 <b>Бесплатный VIP за друзей!</b>\n\nСкопируй или перешли (Forward) сообщение ниже своим друзьям.\n\nКак только друг запустит бота по твоей ссылке, <b>вы ОБА получите по 3 дня VIP-статуса</b> 💎!`;
        await ctx.reply(header, { parse_mode: 'HTML', ...mainMenu });

        const copyText = `Привет! Нашел крутого бота для знакомств ${botUsername} 🔥\n\nТут можно смотреть видеовизитки и искать людей из нашего города без фейков и подписок.\n\nЗаходи по моей пригласительной ссылке ниже, чтобы нам с тобой сразу дали бесплатный VIP-статус: 👇\n\n${refLink}`;
        
        await ctx.reply(copyText);
    });
    bot.command('search', (ctx) => showNextProfile(ctx, String(ctx.from?.id)));

    const isSuperAdmin = (ctx: any) => ctx.from?.username?.toLowerCase() === 'vnezdv';

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

        const waitMsg = await ctx.reply('⏳ Собираю статистику баз данных...');
        
        try {
            const totalUsersSnap = await getCountFromServer(collection(db, 'users'));
            const activeUsersSnap = await getCountFromServer(query(collection(db, 'users'), where('active', '==', true)));
            const premiumUsersSnap = await getCountFromServer(query(collection(db, 'users'), where('is_premium', '==', true)));

            const text = `📊 <b>Статистика бота</b>\n\n` +
                         `👥 <b>Всего зарегистрировано:</b> ${totalUsersSnap.data().count}\n` +
                         `🔥 <b>Активных анкет (онлайн-база):</b> ${activeUsersSnap.data().count}\n` +
                         `💎 <b>VIP статусов:</b> ${premiumUsersSnap.data().count}`;

            await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, null, text, { parse_mode: 'HTML' });
        } catch (e) {
            console.error(e);
            await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, null, '❌ Ошибка при получении статистики.');
        }
    });


    // ----------------------------------------
    // INTERACTIONS (LIKE / DISLIKE / SUPERLIKE )
    // ----------------------------------------
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
            await ctx.reply('⭐️ Оплата прошла успешно! Ваш суперлайк отправлен.', { reply_markup: mainMenu });
            await sendSuperLikeLogic(ctx, fromUserId, toUserId);
            await showNextProfile(ctx, fromUserId);
        } else if (payload === 'PREMIUM_PAY') {
            await setDoc(doc(db, 'users', fromUserId), { is_premium: true }, { merge: true });
            await ctx.reply('💎 <b>Premium-буст активирован!</b>\nТеперь вашу анкету увидит гораздо больше людей.', { parse_mode: 'HTML', reply_markup: mainMenu });
        }
    });

    // ----------------------------------------
    // REPORTING SYSTEM (COMPLAINTS)
    // ----------------------------------------
    bot.action(/^reportP_(.+)$/, async (ctx: any) => {
        const targetId = ctx.match[1];
        await ctx.answerCbQuery();
        
        const kbd = Markup.inlineKeyboard([
            [Markup.button.callback('1. 🔞 Матер. для взрослых', `repR_1_${targetId}`)],
            [Markup.button.callback('2. 💰 Продажа услуг', `repR_2_${targetId}`)],
            [Markup.button.callback('3. 💩 Спам/Мошенничество', `repR_3_${targetId}`)],
            [Markup.button.callback('4. 🦨 Другое', `repR_4_${targetId}`)],
            [Markup.button.callback('🔙 Вернуться назад', `repCancel_${targetId}`)]
        ]);
        
        // Перезаписываем кнопки на карточке
        await ctx.editMessageReplyMarkup(kbd.reply_markup).catch(()=>{});
    });

    bot.action(/^repCancel_(.+)$/, async (ctx: any) => {
        const candidateId = ctx.match[1];
        await ctx.answerCbQuery();
        
        const kbd = Markup.inlineKeyboard([
            [ { text: '❌ Дальше', callback_data: `dislike_${candidateId}` }, { text: '❤️ Лайк', callback_data: `like_${candidateId}` } ],
            [ { text: '🌟 Суперлайк', callback_data: `superlike_${candidateId}` }, { text: '🚨', callback_data: `reportP_${candidateId}` } ]
        ]);
        await ctx.editMessageReplyMarkup(kbd.reply_markup).catch(()=>{});
    });

    bot.action(/^repR_([1-4])_(.+)$/, async (ctx: any) => {
        const reasonId = ctx.match[1];
        const targetId = ctx.match[2];
        const fromId = String(ctx.from?.id);
        
        const reasons: any = { '1': '🔞 Материал для взрослых', '2': '💰 Продажа товаров и услуг', '3': '💩 Спам/Мошенничество', '4': '🦨 Другое' };
        
        await ctx.answerCbQuery('Жалоба отправлена модераторам. Спасибо!', { showAlert: true });
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});
        
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
        await ctx.reply('🔄 <b>Бот был переведен на новую версию.</b>\nСвязь восстановлена, выберите действие в меню 👇', { parse_mode: 'HTML', ...mainMenu }).catch(()=>{});
    });

    // Если пользователь отправил текст/медиа вне сцены и не попал ни в одну кнопку (бот перезагрузился и т.д.)
    bot.on('message', async (ctx: any) => {
        if (ctx.scene) await ctx.scene.leave().catch(()=>{});
        await ctx.reply('🔄 <b>Я всегда на связи!</b>\nЕсли что-то зависло, я автоматически обновил сессию.\n\nЖми пункт меню ниже 👇', { parse_mode: 'HTML', ...mainMenu }).catch(()=>{});
    });

    // Инициализация Webhooks или Long Polling
    const webhookDomain = process.env.WEBHOOK_DOMAIN;
    
    // ВРЕМЕННО ОТКЛЮЧАЕМ РЕЖИМ ЛОКАЛЬНОГО ОПРОСА В AI STUDIO (УСТРАНЕНИЕ ОШИБКИ 409 НА AMVERA)
    const disableLocalPolling = true; // Измените на false, если захотите вернуть работу бота в AI Studio

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
    } else if (!disableLocalPolling) {
        // Запуск через Long Polling (Для среды разработки AI Studio)
        try {
            await bot.telegram.deleteWebhook({ drop_pending_updates: true });
            bot.launch();
            console.log('🚀 Bot is running in Long Polling mode (Development)...');
        } catch (e: any) {
            if (e.response && e.response.error_code === 409) {
                console.error('⛔ СONFLICT: Another instance of the bot is already running. Please stop it or use Webhooks.');
            } else {
                console.error("Long Polling Error:", e);
            }
        }
    } else {
        console.log('⛔ Local Polling is deliberately DISABLED in AI Studio to allow the bot to run correctly on Amvera without 409 conflicts.');
    }

    const port = process.env.PORT || 3000;
    expressApp.listen(port, '0.0.0.0', () => {
        console.log(`🌐 HTTP Server listening on port ${port}`);
    });

    process.once('SIGINT', () => { bot.stop('SIGINT') });
    process.once('SIGTERM', () => { bot.stop('SIGTERM') });
    console.log('Bot is heavily optimized with Premium Subscriptions and Admin Reporting...');
}
