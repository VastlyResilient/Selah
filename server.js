// Morning Word - Bible Verse SMS Service
// Backend: Express + node-cron + Twilio + JSON file storage

require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Twilio client ──────────────────────────────────────────────────────────
const FROM = process.env.TWILIO_FROM;

if (!process.env.TWILIO_SID || !process.env.TWILIO_TOKEN) {
  console.error('WARNING: Twilio credentials missing. SMS will not be sent.');
}

const twilioClient = (process.env.TWILIO_SID && process.env.TWILIO_TOKEN)
  ? twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN)
  : null;

// ── Subscriber storage (JSON file) ────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'data', 'subscribers.json');
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

function loadSubs() {
  if (!fs.existsSync(DB_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return []; }
}

function saveSubs(subs) {
  fs.writeFileSync(DB_PATH, JSON.stringify(subs, null, 2));
}

// ── Verses by theme ───────────────────────────────────────────────────────
const verses = {
  Encouragement: [
    { text: "I can do all things through Christ who strengthens me.", ref: "Philippians 4:13" },
    { text: "For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you, plans to give you hope and a future.", ref: "Jeremiah 29:11" },
    { text: "Be strong and courageous. Do not be afraid; do not be discouraged, for the Lord your God will be with you wherever you go.", ref: "Joshua 1:9" },
    { text: "Come to me, all you who are weary and burdened, and I will give you rest.", ref: "Matthew 11:28" },
    { text: "The Lord himself goes before you and will be with you; he will never leave you nor forsake you.", ref: "Deuteronomy 31:8" },
    { text: "But those who hope in the Lord will renew their strength. They will soar on wings like eagles.", ref: "Isaiah 40:31" },
    { text: "Cast all your anxiety on him because he cares for you.", ref: "1 Peter 5:7" },
  ],
  Wisdom: [
    { text: "Trust in the Lord with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight.", ref: "Proverbs 3:5-6" },
    { text: "If any of you lacks wisdom, you should ask God, who gives generously to all without finding fault, and it will be given to you.", ref: "James 1:5" },
    { text: "The fear of the Lord is the beginning of wisdom, and knowledge of the Holy One is understanding.", ref: "Proverbs 9:10" },
    { text: "Your word is a lamp for my feet, a light on my path.", ref: "Psalm 119:105" },
    { text: "Do not conform to the pattern of this world, but be transformed by the renewing of your mind.", ref: "Romans 12:2" },
    { text: "Listen to advice and accept discipline, and at the end you will be counted among the wise.", ref: "Proverbs 19:20" },
  ],
  Peace: [
    { text: "Peace I leave with you; my peace I give you. I do not give to you as the world gives. Do not let your hearts be troubled.", ref: "John 14:27" },
    { text: "And the peace of God, which transcends all understanding, will guard your hearts and your minds in Christ Jesus.", ref: "Philippians 4:7" },
    { text: "You will keep in perfect peace those whose minds are steadfast, because they trust in you.", ref: "Isaiah 26:3" },
    { text: "The Lord gives strength to his people; the Lord blesses his people with peace.", ref: "Psalm 29:11" },
    { text: "Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God.", ref: "Philippians 4:6" },
  ],
  Strength: [
    { text: "The Lord is my strength and my song; he has given me victory.", ref: "Exodus 15:2" },
    { text: "He gives strength to the weary and increases the power of the weak.", ref: "Isaiah 40:29" },
    { text: "I lift up my eyes to the mountains - where does my help come from? My help comes from the Lord.", ref: "Psalm 121:1-2" },
    { text: "Be on your guard; stand firm in the faith; be courageous; be strong.", ref: "1 Corinthians 16:13" },
    { text: "The Lord is my rock, my fortress and my deliverer; my God is my rock, in whom I take refuge.", ref: "Psalm 18:2" },
    { text: "Finally, be strong in the Lord and in his mighty power.", ref: "Ephesians 6:10" },
  ],
  Faith: [
    { text: "Now faith is confidence in what we hope for and assurance about what we do not see.", ref: "Hebrews 11:1" },
    { text: "For we live by faith, not by sight.", ref: "2 Corinthians 5:7" },
    { text: "Jesus replied, 'What is impossible with man is possible with God.'", ref: "Luke 18:27" },
    { text: "If you have faith as small as a mustard seed, you can say to this mountain, 'Move from here to there,' and it will move.", ref: "Matthew 17:20" },
    { text: "And without faith it is impossible to please God, because anyone who comes to him must believe that he exists.", ref: "Hebrews 11:6" },
  ],
  Love: [
    { text: "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.", ref: "John 3:16" },
    { text: "Love is patient, love is kind. It does not envy, it does not boast, it is not proud.", ref: "1 Corinthians 13:4" },
    { text: "We love because he first loved us.", ref: "1 John 4:19" },
    { text: "Greater love has no one than this: to lay down one's life for one's friends.", ref: "John 15:13" },
    { text: "And over all these virtues put on love, which binds them all together in perfect unity.", ref: "Colossians 3:14" },
  ],
};

function getDailyVerse(theme) {
  const pool = verses[theme] || verses['Encouragement'];
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return pool[dayOfYear % pool.length];
}

// ── API: Subscribe ─────────────────────────────────────────────────────────
app.post('/api/subscribe', async (req, res) => {
  const { phone, theme, timezone, sendTime } = req.body;

  if (!phone || !theme) return res.status(400).json({ error: 'Phone and theme required.' });

  const normalizedPhone = phone.replace(/\s/g, '');
  const subs = loadSubs();

  // Check if already subscribed
  if (subs.find(s => s.phone === normalizedPhone && s.active)) {
    return res.status(409).json({ error: 'This number is already subscribed!' });
  }

  const token = crypto.randomBytes(16).toString('hex');
  const sub = {
    id: token,
    phone: normalizedPhone,
    theme,
    timezone: timezone || 'America/New_York',
    sendTime: sendTime || '07:00',
    active: true,
    createdAt: new Date().toISOString(),
  };

  subs.push(sub);
  saveSubs(subs);

  // Send welcome text
  const appUrl = process.env.APP_URL || 'https://your-app.railway.app';
  try {
    if (!twilioClient) throw new Error('Twilio not configured');
    await twilioClient.messages.create({
      to: normalizedPhone,
      from: FROM,
      body: `${welcomeMessage(theme, sendTime)}`,
    });
  } catch (err) {
    console.error('Welcome SMS failed:', err.message);
    // Still return success - they're in the DB
  }

  res.json({ success: true, message: 'Subscribed! Check your phone for a welcome message.' });
});

// ── API: Unsubscribe (via token link) ─────────────────────────────────────
app.get('/unsubscribe', (req, res) => {
  const { token } = req.query;
  const subs = loadSubs();
  const sub = subs.find(s => s.id === token);

  if (!sub) return res.send(renderPage('Not Found', 'That unsubscribe link is invalid or already used.', false));

  sub.active = false;
  saveSubs(subs);

  res.send(renderPage('Unsubscribed', `You've been removed from Morning Word. We're sorry to see you go! You can always re-subscribe at <a href="/">the homepage</a>.`, true));
});

// ── API: Subscriber count (public stats) ──────────────────────────────────
app.get('/api/stats', (req, res) => {
  const subs = loadSubs();
  res.json({ count: subs.filter(s => s.active).length });
});

function renderPage(title, message, success) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title} - Morning Word</title>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;1,400&family=Lato:wght@300;400&display=swap" rel="stylesheet">
  <style>body{font-family:'Lato',sans-serif;background:#fdf6ec;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .box{background:white;border:1px solid rgba(201,146,42,0.2);border-radius:2px;padding:48px;max-width:440px;text-align:center;box-shadow:0 8px 40px rgba(74,46,10,0.08)}
  h1{font-family:'Playfair Display',serif;color:#4a2e0a;margin-bottom:16px}p{color:#9a7a55;line-height:1.7}a{color:#c9922a}
  .icon{font-size:2.5rem;margin-bottom:16px}</style></head>
  <body><div class="box"><div class="icon">${success ? '🙏' : '❌'}</div><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

// ── Morning greeting rotator - theme-matched ─────────────────────────────
const GREETINGS = {
  Encouragement: [
    '🌅 Good morning. He is already at work in your day.',
    '✝️ Rise, beloved. The Lord your God is with you.',
    '💛 You are not alone in this. He goes before you.',
    '🌄 A new morning. His strength is made perfect in you.',
    '🙏 Today is a gift. Walk in it with courage.',
    '🦅 Soar on wings like eagles. He renews the weary.',
    '🌿 Do not be discouraged. The Lord your God is near.',
    '☀️ Stand firm. The One who called you is faithful.',
    '✨ You were made for more than you can see right now.',
    '🌸 He holds your future. Rest in that this morning.',
    '💪 Courage is not the absence of fear. It is trusting Him through it.',
    '🔥 The same God who parted the sea walks with you today.',
    '🌊 Cast every burden on Him. He cares for you deeply.',
    '📣 Be strong. Be courageous. He has not left you.',
    '🌻 Today may be hard. He is still good. He is still here.',
    '🕊️ His peace will guard your heart as you step forward.',
    '🌙 Whatever kept you up - He was watching over you.',
    '🌤️ His mercies are fresh this morning. Receive them.',
    '💫 You are more than a conqueror through Christ who loves you.',
    '🎯 Fix your eyes on Him. Everything else will come into focus.',
    '🏔️ When the mountain feels immovable, remember who made it.',
    '🌱 Small steps of faith become great works in His hands.',
    '🔑 Every door He opens, no man can shut. Keep walking.',
    '⚓ He is your anchor. You will not drift beyond His reach.',
    '🛡️ You are covered. Go into today without fear.',
    '🌈 After every storm, He remains. And so will you.',
    '📖 His Word over you today: you are not forgotten.',
    '💡 When you cannot see the path, trust the One who laid it.',
    '🎶 Sing, even in the valley. He inhabits the praise of His people.',
    '🙌 He has not brought you this far to leave you here.',
  ],
  Wisdom: [
    '📖 Good morning. Still your heart. Listen for His voice.',
    '🕯️ Let His Word be a lamp to your feet today.',
    '🌿 True wisdom begins in reverence. Begin there this morning.',
    '🧭 When the path is unclear, the Word lights the way.',
    '🌅 A wise heart seeks counsel. His Word is always available.',
    '✝️ The mind renewed by truth sees what the world cannot.',
    '🔍 Search Scripture today. You will find what you need.',
    '📿 Lean not on your own understanding. Trust His.',
    '🌊 Deep calls to deep. Go deeper in Him today.',
    '🌱 What you plant in the Word today, you will harvest in due season.',
    '🔑 Understanding comes to those who ask. Ask boldly.',
    '🎓 A teachable heart is a treasure. Remain open.',
    '🕊️ Wisdom is not just knowing. It is walking in what you know.',
    '🌄 The fear of the Lord is the beginning. Start there.',
    '💡 His ways are higher. Trust what you cannot fully see.',
    '🧠 Renew your mind. The world will try to conform it daily.',
    '⚖️ Discernment is a gift. Ask for it without hesitation.',
    '📜 Every answer you need is hidden in plain sight in Scripture.',
    '🌙 Meditate on His Word. Let it go deep before the day begins.',
    '🏛️ Build on the rock. Everything else is shifting sand.',
    '✨ A wise person knows what they do not know. Stay humble.',
    '🌸 Knowledge puffs up. Love builds up. Pursue both today.',
    '🔭 Eternity in view changes every decision you make today.',
    '📣 Counsel from the Lord stands forever. Every other voice fades.',
    '🗝️ Obedience unlocks understanding. Step forward in faith.',
    '🌤️ The man who walks with the wise grows wise. Choose your circle.',
    '🌻 Guard your heart. What goes in shapes what comes out.',
    '💎 Wisdom is worth more than silver. Pursue it like treasure.',
    '🎯 The right word at the right time comes from a heart steeped in truth.',
    '🙏 Before you speak today, listen. Before you decide, pray.',
  ],
  Peace: [
    '🕊️ Good morning. You are held in perfect peace.',
    '🌊 Still waters. He leads you there. Follow.',
    '🌿 Breathe. He is sovereign over everything you are anxious about.',
    '☁️ Let your mind rest in Him. He guards what you give Him.',
    '🌅 The storm does not define the morning. He does.',
    '🙏 Cast it. Every weight. Every worry. He is able to carry it.',
    '💤 He gives sleep to His beloved. Rise in that rest.',
    '🌸 Do not be anxious. His peace surpasses all understanding.',
    '🌙 Last night He watched over you. This morning He still does.',
    '🕯️ A quiet spirit is a strong spirit. Still yourself before Him.',
    '🌤️ Whatever stirs in you today - bring it to Him first.',
    '🌈 The God of peace will crush every fear beneath your feet.',
    '⚓ You are anchored to something that cannot be shaken.',
    '🦢 Quiet your heart. He speaks in the stillness.',
    '☮️ He is not the author of confusion. Rest in His clarity.',
    '💛 You do not have to carry today alone. He is already in it.',
    '🌻 Tend to your soul this morning. Start with His presence.',
    '📖 His Word brings peace to the places that reasoning cannot reach.',
    '🌱 Growth happens in seasons of stillness. Do not rush through this.',
    '🎵 The Lord your God is in your midst. He rejoices over you.',
    '🛡️ Perfect love casts out fear. You are perfectly loved.',
    '🌊 The same voice that calmed the sea speaks peace to you now.',
    '🏡 In Him, you have a dwelling place no storm can take from you.',
    '💫 He keeps in perfect peace the mind that is stayed on Him.',
    '🌄 Rise without dread. He has already prepared this day.',
    '🕊️ Lay it down. He is a better keeper of it than you are.',
    '🌿 Peaceful mornings begin with surrendered hearts.',
    '✝️ The cross settled the greatest debt. Let that silence every other fear.',
    '🌅 His peace is not the absence of trouble. It is His presence in it.',
    '🙌 Today is not yours to carry. It is His to lead. Follow.',
  ],
  Strength: [
    '💪 Good morning. You are stronger than yesterday because He is the same.',
    '🏔️ The mountain is real. But He who is in you is greater.',
    '🔥 His fire in you does not diminish. Draw from it today.',
    '⚔️ Put on the full armor. This is not a day to be unarmed.',
    '🦁 Be bold. The righteous are as bold as a lion.',
    '🌅 Rise, warrior. The battle belongs to the Lord.',
    '🛡️ He is your rock, your fortress, your deliverer. Stand on that.',
    '⚓ When your strength fails, His is just beginning.',
    '🏋️ He gives power to the weak. Ask for it this morning.',
    '🌊 He parted the sea. He will make a way for you too.',
    '🔑 Courage is not self-generated. It flows from knowing who holds you.',
    '✝️ The same power that raised Christ from the dead lives in you.',
    '🌤️ Weeping may last the night. Joy rises in the morning.',
    '🦅 He renews strength like eagles. Surrender the exhaustion.',
    '💫 You have not been given a spirit of fear. Walk in power today.',
    '🌱 Planted by living water, you will not wither under pressure.',
    '🔭 Eternal perspective turns every present hardship into light momentary trouble.',
    '🎯 Stay the course. The finish line is worth the race.',
    '📣 He who began a good work in you will complete it. Hold on.',
    '🌸 His grace is sufficient for exactly what you face today.',
    '⚡ His strength is not limited by your limitation. Trust that.',
    '🏹 Every arrow aimed at you must first pass through His hand.',
    '🌻 Even in the wilderness, He provides. You will not run dry.',
    '💡 The Lord is your light. You do not have to navigate darkness alone.',
    '🧱 Built on the rock, you will not be swept away.',
    '🌈 He turns mourning into dancing. The turn is coming.',
    '🙏 Lean hard into Him today. He does not bend under your weight.',
    '📖 Every promise He has made is yes and amen. Stand on them.',
    '🔥 The furnace did not consume them. The fourth man was in the fire.',
    '🌄 He restores the soul. Begin there. Everything else follows.',
  ],
  Faith: [
    '✨ Good morning. Walk today by faith, not by what you see.',
    '🌱 A mustard seed of faith can move what towers over you.',
    '🕊️ Trust Him with the part of the story you cannot read yet.',
    '📖 Faith is not blind. It sees clearly - just beyond the visible.',
    '🌅 Step out. He meets faith in motion, not in hesitation.',
    '🔥 What God has spoken will come to pass. Hold the promise.',
    '⚓ Hope anchors the soul. Hope does not disappoint.',
    '🌊 Peter walked on water. He only sank when he stopped looking at Christ.',
    '💫 The unseen is more real than what you can touch today.',
    '🎯 Faith is the substance of things hoped for. Hope boldly.',
    '🌙 Even in darkness, Abraham believed. So can you.',
    '🏔️ Every miracle in Scripture began with someone who dared to believe.',
    '🌿 Do not despise the day of small beginnings. God is in it.',
    '🔑 Obedience is the language of faith. Take the next step.',
    '✝️ The resurrection is proof. What He promises, He performs.',
    '🌸 He is working even when you cannot see it. Especially then.',
    '🛡️ Faith is not a feeling. It is a fixed decision to trust God.',
    '💡 The same God who spoke light into darkness speaks into yours.',
    '🌤️ Clouds do not mean the sun has gone. He has not moved.',
    '🦅 Rise above circumstance. That is the altitude of faith.',
    '📣 Declare His promises out loud today. Faith comes by hearing.',
    '🎶 Praise before the breakthrough is the highest act of faith.',
    '🌻 Every answered prayer was once an impossible situation.',
    '💎 Tried faith is precious faith. The fire is making you stronger.',
    '🌈 He is the God of the impossible. Pray like it.',
    '🙌 When you cannot trace His hand, trust His heart.',
    '🌱 Water the seed of faith daily with His Word. Watch it grow.',
    '🔭 Fix your eyes on what is eternal. The temporary will not hold you.',
    '🏹 Release your arrow of faith. He will guide it to the target.',
    '🌄 The dawn breaks. His faithfulness is right on time.',
  ],
  Love: [
    '❤️ Good morning, beloved. You are loved with an everlasting love.',
    '🌸 Nothing you do today will make Him love you more or less.',
    '🕊️ You were chosen before the foundation of the world. That is love.',
    '💛 His love is not earned. It is given. Receive it freely.',
    '✝️ The cross is the measure of how much He loves you. Immeasurable.',
    '🌅 Rise knowing you are seen, known, and deeply loved by the Creator.',
    '🌿 He calls you His own. That identity cannot be taken from you.',
    '🌊 His steadfast love never ceases. It was there when you woke up.',
    '💫 You are not loved for what you produce. You are loved because He chose you.',
    '🌹 Greater love has no one than this. He laid down His life for you.',
    '🙏 His love pursues. It does not give up. It never has.',
    '📖 He has engraved you on the palms of His hands. You are remembered.',
    '🌤️ Start today from a place of being loved, not trying to earn it.',
    '✨ You are His. That is your identity before any other label.',
    '🌸 Love is patient. Love is kind. He shows you both every morning.',
    '💡 The One who made the stars knows your name. That is love.',
    '🌻 He delights in you. Not in your performance. In you.',
    '🌙 While you slept, His love did not. It kept watch over you.',
    '🦋 You are a new creation. The old is gone. That is what love does.',
    '🌈 His mercies are new because His love is unfailing.',
    '❤️‍🔥 He loved you at your worst. Imagine what He will do with your best.',
    '🎵 He rejoices over you with singing. You are His song.',
    '🌱 Rooted in His love, nothing that comes today can uproot you.',
    '🏡 In Him you are home. No matter how far you have wandered.',
    '💎 You are precious in His sight. Honored. Loved.',
    '🌄 Before the day begins, He has already loved you through it.',
    '🕯️ His love is a light that darkness has never - and will never - overcome.',
    '🌊 Nothing in creation can separate you from His love. Nothing.',
    '🙌 Loved. Redeemed. Restored. Walk in that today.',
    '✝️ Every morning is proof that His mercies endure forever.',
  ],
};

function greeting(theme) {
  const pool = GREETINGS[theme] || GREETINGS['Encouragement'];
  return pool[Math.floor(Math.random() * pool.length)];
}

const WELCOME_MESSAGES = [
  (theme, time) => `🌅 Welcome to Selah.\n\nYou are subscribed to daily ${theme} verses, arriving each morning at ${time}.\n\n"The Lord bless you and keep you; the Lord make His face shine on you." - Numbers 6:24-25`,
  (theme, time) => `✝️ Welcome, beloved.\n\nEach morning at ${time}, a ${theme} verse will meet you right where you are.\n\n"Your word is a lamp to my feet and a light to my path." - Psalm 119:105`,
  (theme, time) => `🕊️ You have taken a faithful step.\n\nDaily ${theme} scripture will arrive at ${time} to anchor your morning in truth.\n\n"In the morning, Lord, you hear my voice." - Psalm 5:3`,
  (theme, time) => `🌿 Grace and peace to you.\n\nSelah will deliver a ${theme} verse each morning at ${time} - a pause, a breath, a reminder.\n\n"His mercies are new every morning. Great is Your faithfulness." - Lamentations 3:23`,
  (theme, time) => `📖 Welcome to the daily Word.\n\n${theme} scripture, sent faithfully at ${time} each morning.\n\n"So faith comes from hearing, and hearing through the word of Christ." - Romans 10:17`,
];

function welcomeMessage(theme, sendTime) {
  const msg = WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)];
  return msg(theme, sendTime);
}

// ── Cron: Send verses every minute, check who needs a text ────────────────
cron.schedule('* * * * *', async () => {
  const now = new Date();
  const subs = loadSubs().filter(s => s.active);
  const appUrl = process.env.APP_URL || 'https://your-app.railway.app';

  for (const sub of subs) {
    try {
      const localTime = new Intl.DateTimeFormat('en-US', {
        timeZone: sub.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(now);

      if (localTime === sub.sendTime) {
        if (!twilioClient) { console.error('Twilio not configured'); continue; }
        const verse = getDailyVerse(sub.theme);
        await twilioClient.messages.create({
          to: sub.phone,
          from: FROM,
          body: `${greeting(sub.theme)}\n\n"${verse.text}"\n\n- ${verse.ref}`,
        });
        console.log(`Sent ${sub.theme} verse to ${sub.phone}`);
      }
    } catch (err) {
      console.error(`Failed for ${sub.phone}:`, err.message);
    }
  }
});

// ── Incoming SMS webhook (Twilio calls this when someone texts back) ──────
app.post('/sms', (req, res) => {
  const body = (req.body.Body || '').trim().toLowerCase();
  const from = req.body.From || '';

  const subs = loadSubs();
  const sub = subs.find(s => s.phone === from && s.active);

  let responseText = '';

  // STOP - unsubscribe
  if (['stop', 'unsubscribe', 'cancel', 'quit', 'end'].includes(body)) {
    if (sub) {
      sub.active = false;
      saveSubs(subs);
      responseText = 'You have been unsubscribed from Selah. We are sorry to see you go. You can always return at selah.app. "The Lord bless you and keep you." - Numbers 6:24';
    } else {
      responseText = 'You are not currently subscribed to Selah.';
    }
  }

  // START / UNSTOP - re-subscribe
  else if (['start', 'subscribe', 'yes'].includes(body)) {
    if (sub) {
      responseText = 'You are already subscribed to Selah. Your daily scripture will continue arriving each morning. 🙏';
    } else {
      // Re-activate if previously unsubscribed
      const oldSub = subs.find(s => s.phone === from);
      if (oldSub) {
        oldSub.active = true;
        saveSubs(subs);
        responseText = 'Welcome back to Selah. 🙏 Your daily scripture will resume tomorrow morning. "His mercies are new every morning." - Lamentations 3:23';
      } else {
        responseText = 'To subscribe to Selah, visit us at selah.app. Daily scripture. Free always. ✝️';
      }
    }
  }

  // CHANGE TO [THEME] - switch theme
  else if (body.startsWith('change to ')) {
    const requested = body.replace('change to ', '').trim();
    const themeMap = {
      'encouragement': 'Encouragement',
      'wisdom': 'Wisdom',
      'peace': 'Peace',
      'strength': 'Strength',
      'faith': 'Faith',
      'love': 'Love',
    };
    const newTheme = themeMap[requested];
    if (!sub) {
      responseText = 'You are not currently subscribed to Selah. Visit selah.app to subscribe. ✝️';
    } else if (!newTheme) {
      responseText = `"${requested}" is not a valid theme. Available themes: Encouragement, Wisdom, Peace, Strength, Faith, Love.`;
    } else {
      sub.theme = newTheme;
      saveSubs(subs);
      responseText = `Done. Your daily theme has been updated to ${newTheme}. Starting tomorrow morning your verses will reflect this. 🙏`;
    }
  }

  // HELP
  else if (body === 'help') {
    responseText = 'Selah - Daily Scripture by SMS.\n\nCommands:\nSTOP - unsubscribe\nSTART - resubscribe\nChange to [theme] - switch your theme\n\nThemes: Encouragement, Wisdom, Peace, Strength, Faith, Love\n\nVisit selah.app';
  }

  // Any other reply - gentle response
  else {
    responseText = sub
      ? `Thank you for reaching out. Selah delivers daily scripture to your phone each morning. Reply HELP for options or visit selah.app. 🙏`
      : `Thank you for your message. To subscribe to daily scripture, visit selah.app. Free always. ✝️`;
  }

  // Respond with TwiML
  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${responseText}</Message></Response>`);
});

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Morning Word running on port ${PORT}`));

// ── Prayer storage ─────────────────────────────────────────────────────────
const PRAYER_PATH = path.join(__dirname, 'data', 'prayers.json');

function loadPrayers() {
  if (!fs.existsSync(PRAYER_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(PRAYER_PATH, 'utf8')); }
  catch { return []; }
}

function savePrayers(prayers) {
  fs.writeFileSync(PRAYER_PATH, JSON.stringify(prayers, null, 2));
}

// GET all prayers
app.get('/api/prayers', (req, res) => {
  const prayers = loadPrayers();
  res.json(prayers.slice().reverse());
});

// POST new prayer
app.post('/api/prayers', (req, res) => {
  const { name, request, category } = req.body;
  if (!request || !request.trim()) {
    return res.status(400).json({ error: 'Prayer request is required.' });
  }
  const prayers = loadPrayers();
  const prayer = {
    id: crypto.randomBytes(8).toString('hex'),
    name: name && name.trim() ? name.trim() : 'Anonymous',
    request: request.trim(),
    category: category || 'General',
    prayedCount: 0,
    createdAt: new Date().toISOString(),
  };
  prayers.push(prayer);
  savePrayers(prayers);
  res.json({ success: true, prayer });
});

// POST I Prayed
app.post('/api/prayers/:id/prayed', (req, res) => {
  const prayers = loadPrayers();
  const prayer = prayers.find(p => p.id === req.params.id);
  if (!prayer) return res.status(404).json({ error: 'Not found.' });
  prayer.prayedCount = (prayer.prayedCount || 0) + 1;
  savePrayers(prayers);
  res.json({ success: true, prayedCount: prayer.prayedCount });
});

// ── Selah AI Companion (OpenAI GPT-4o) ────────────────────────────────────
const SELAH_SYSTEM_PROMPT = `Identity & Foundation

You are Selah - an AI companion trained on Scripture, historic Christian teaching, pastoral counseling principles, testimonies, sermons, theological writings, and biblical wisdom.

Your goal is to provide deeply rooted, Scripture-centered, emotionally intelligent guidance to individuals who are suffering, confused, tempted, grieving, anxious, lonely, or seeking to grow in Christ.

You are not casual.
You are not robotic.
You are not preachy.
You are not shallow.

You are thoughtful.
You are anchored in the Word.
You are compassionate.
You are steady.
You are resolute in truth and gentle in tone.

You do not claim to be human.
You do not refer to yourself as a "brother in Christ."
You do not speak about being an AI.

You speak as someone who has deeply searched the Scriptures, studied sermons, listened to testimonies, and carefully discerned biblical wisdom.

Core Framework of Every Response

When someone shares a struggle, your response should follow this reasoning structure (without explicitly labeling it):

1. Deep Listening
Identify what they are truly feeling (fear, shame, anger, grief, confusion, temptation, spiritual dryness, loneliness).
Reflect their emotional state with care.
Validate the weight of what they are experiencing without affirming sin.

2. Reframe Through Biblical Truth
Gently shift perspective toward eternal truth.
Tie their struggle into the greater spiritual battle and the brokenness of the world.
Use Scripture organically - not dumped, but woven into the reasoning.
You may quote Scripture, paraphrase Scripture, reference biblical figures, and reference themes like spiritual warfare, sanctification, suffering, perseverance, repentance, renewal.

3. Call to Action (Practical, Spiritual, Grounded)
Give specific next steps. The advice must be actionable, spiritually mature, not vague clichés, and not repetitive.

4. Encourage Growth, Not Perfection
Reinforce that Christians are not perfect - they are growing. Faith is active. God does not abandon His children.
Avoid empty reassurance, "everything will be fine," prosperity-gospel thinking, and shame-based guilt.

Tone & Voice Guidelines
Speak with calm authority.
Avoid church clichés.
Avoid sounding like a sermon transcript.
Vary sentence structure.
Use metaphor thoughtfully.
Use vivid but grounded language.
Occasionally ask reflective questions to guide them deeper.
Never repeat phrasing from previous responses.
Every response must feel uniquely crafted for that person.

Theological Guardrails
Christ is the only mediator. Salvation is by grace through faith. Repentance is ongoing. Growth is evidence of life. Community is essential. Scripture is final authority. Emotional experience does not override truth. Suffering is not meaningless. Spiritual warfare is real but not dramatized. Accountability is necessary. Discipline is loving, not harsh.

Context Awareness
Before responding, analyze the emotional weight of the message, the theological misunderstanding (if any), the spiritual maturity level, and the likely root fear. Tailor depth accordingly. Do not over-theologize someone in acute emotional distress. Do not under-challenge someone excusing sin.

Format Guidelines
Keep responses focused and readable - not excessively long. Use short paragraphs. When quoting Scripture, format it clearly. End every response with encouragement rooted in Scripture, a tone of strength, a reminder that growth takes time, and a subtle call to continue walking - not quitting. Never end abruptly. Never end clinically.`;

app.post('/api/selah', async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required.' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'AI service not configured.' });
  }
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 600,
        temperature: 0.85,
        messages: [
          { role: 'system', content: SELAH_SYSTEM_PROMPT },
          { role: 'user', content: message.trim() },
        ],
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('OpenAI error:', data);
      return res.status(500).json({ error: 'AI service error.' });
    }
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) return res.status(500).json({ error: 'No response from AI.' });
    res.json({ reply });
  } catch (err) {
    console.error('Selah AI error:', err.message);
    res.status(500).json({ error: 'Could not reach AI service.' });
  }
});
