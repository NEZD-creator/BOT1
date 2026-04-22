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

    const formatCard = (d: any) => {
        return `<b>${d.name}, ${d.age}</b>\n🏙 <i>${d.city}</i>\n━━━━━━━━━━━━━━\n📝 ${d.bio}`;
    };

    const mainMenu = Markup.keyboard([
        ['🔥 Лента', '🔍 Умный поиск'],
        ['👤 Мой профиль']
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
    bot.catch((err) => console.error("Bot Error", err));
    bot.use(session());
    bot.use(stage.middleware() as any);

    bot.start(async (ctx: any) => {
        const uid = String(ctx.from?.id);
        const userDoc = await getDoc(doc(db, 'users', uid));
        if (userDoc.exists()) {
            await ctx.reply('<b>С возвращением!</b> Нажимай «🔥 Лента», чтобы продолжить поиск! 💘', { parse_mode: 'HTML', ...mainMenu });
        } else {
            await ctx.reply('<b>Привет! Бот-Дейтинг на связи.</b> 💘\nТут можно найти классную компанию, вторую половину или новых друзей.\n\nЖми кнопку ниже, чтобы заполнить анкету!', 
                { parse_mode: 'HTML', ...Markup.inlineKeyboard([[{ text: '📝 Создать профиль', callback_data: 'edit_profile' }]]) }
            );
        }
    });

    // ----------------------------------------
    // MY PROFILE UI
    // ----------------------------------------
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
            [{ text: '✏️ Редактировать профиль', callback_data: 'edit_profile' }],
            [{ text: d.active ? '👁️‍🗨️ Скрыть анкету (Пауза)' : '🚀 Включить и искать', callback_data: 'toggle_active' }]
        ]);
        
        const sentMsg = await sendMedia(ctx, d, caption, kbd.reply_markup);
        if (sentMsg) {
            if (!ctx.session) ctx.session = {};
            ctx.session.myProfileMsgId = sentMsg.message_id;
        }
    }

    bot.hears('👤 Мой профиль', (ctx) => showMyProfile(ctx, String(ctx.from.id)));
    bot.action('edit_profile', async (ctx: any) => { 
        await ctx.answerCbQuery();
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
            ctx.answerCbQuery(newState ? 'Анкета включена! 🚀' : 'Анкета спрятана! 💤');
            await showMyProfile(ctx, uid);
        }
    });

    // ----------------------------------------
    // DISCOVERY SYSTEM (SMART MATCHING)
    // ----------------------------------------
    async function showNextProfile(ctx: any, telegramId: string) {
        try {
            const userDoc = await getDoc(doc(db, 'users', telegramId));
            if (!userDoc.exists()) return ctx.reply('Надо заполнить анкету!', Markup.inlineKeyboard([[{ text: '📝 Заполнить', callback_data: 'edit_profile' }]]));
            const myProfile = userDoc.data()!;
            
            if (!myProfile.active) return ctx.reply('<b>Упс!</b> Твоя анкета скрыта. 💤\nВключи её в «👤 Мой профиль», чтобы смотреть других.', { parse_mode: 'HTML', ...mainMenu });

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
                if (b.telegram_id === telegramId) continue;
                
                // Gender match filter
                if (b.target_gender !== 'target_any') {
                    const theirSearchGender = b.target_gender === 'target_m' ? 'gender_m' : 'gender_f';
                    if (theirSearchGender !== myProfile.gender) continue;
                }

                // Keyword Keyword search matching
                if (searchQuery) {
                    if (!b.bio || !b.bio.toLowerCase().includes(searchQuery)) continue;
                }
                
                if (interactedMap.has(b.telegram_id)) {
                    seen.push({ profile: b, lastInteraction: interactedMap.get(b.telegram_id) });
                } else {
                    unseen.push(b);
                }
            }
            
            // SMART SCORING ALGORITHM
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
                if (searchQuery) {
                    return ctx.reply(`<b>Нет анкет со словом:</b> <i>${searchQuery}</i> 🏜️\n\nНажми «🔥 Лента», чтобы смотреть всех!`, { parse_mode: 'HTML', ...mainMenu });
                }
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
                    { text: '🌟 Суперлайк', callback_data: `superlike_${candidateToShow.telegram_id}` } 
                ]
            ]);
            
            await sendMedia(ctx, candidateToShow, caption, kbd.reply_markup);
            
        } catch (err) { console.error(err); ctx.reply('Ошибка поиска. Попробуйте еще раз.', mainMenu); }
    }

    bot.hears('🔥 Лента', async (ctx: any) => {
        if (ctx.session) ctx.session.currentSearchQuery = null; // Clear filter!
        await showNextProfile(ctx, String(ctx.from.id));
    });
    
    bot.hears('🔍 Умный поиск', async (ctx: any) => {
        ctx.scene.enter('interest-wizard');
    });
    
    bot.command('search', (ctx) => showNextProfile(ctx, String(ctx.from?.id)));


    // ----------------------------------------
    // INTERACTIONS (LIKE / DISLIKE / SUPERLIKE )
    // ----------------------------------------
    
    // STANDARD LIKE
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

    // Helper to send superlike after successful payment or free usage
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

    // SUPER LIKE 
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
                ctx.answerCbQuery(`🌟 Суперлайк доставлен! (Осталось бесплатных сегодня: ${2 - used})`, { showAlert: true });

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
        } catch(e) {
            ctx.answerCbQuery('Ошибка');
            console.error(e);
        }
    });

    // Telegram Stars Payment Webhooks
    bot.on('pre_checkout_query', async (ctx: any) => {
        await ctx.answerPreCheckoutQuery(true).catch(console.error);
    });

    bot.on('successful_payment', async (ctx: any) => {
        const payload = ctx.message.successful_payment.invoice_payload;
        if (payload && payload.startsWith('SL_')) {
            const toUserId = payload.replace('SL_', '');
            const fromUserId = String(ctx.from?.id);
            
            await ctx.reply('⭐️ Оплата прошла успешно! Ваш суперлайк отправлен.', { reply_markup: mainMenu });
            
            await sendSuperLikeLogic(ctx, fromUserId, toUserId);
            await showNextProfile(ctx, fromUserId);
        }
    });

    // DISLIKE
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

    bot.launch();
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
    console.log('Bot is running heavily optimized with beautiful UI and Telegram Stars monetization...');
}
