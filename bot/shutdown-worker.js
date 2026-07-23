// ============================================================
//  VALMONT — Bot Telegram « Shutdown 00h30 » (Cloudflare Worker)
// ------------------------------------------------------------
//  Rôle : chaque nuit à 00h30 (heure de Paris), le bot te pose
//  3 questions pour fermer ta journée, puis logge ta série
//  (streak) de discipline. Objectif : ne jamais finir une
//  journée sans avoir défini la prochaine action.
//
//    1/3  Tes 3 priorités du jour, tu les as faites ?
//    2/3  Journal de trading rempli ?
//    3/3  LA priorité n°1 de demain (une phrase)
//
//  Commandes utiles :
//    /shutdown  → lance le rituel manuellement (pour tester)
//    /streak    → affiche ta série + ta prochaine priorité
//    /focus     → renvoie ta priorité enregistrée
//    /start     → renvoie ton CHAT_ID (utile à l'installation)
//
//  Config (voir INSTALLER-LE-BOT.md) :
//    - Secret  BOT_TOKEN        (donné par BotFather)
//    - Secret  WEBHOOK_SECRET   (une longue chaîne que tu inventes)
//    - Secret  CHAT_ID          (obtenu en écrivant /start au bot)
//    - Binding KV  SHUTDOWN_KV  (stockage du streak et des logs)
//    - Cron    "30 22 * * *"    (00h30 Paris en été ; hiver : 30 23)
// ============================================================

// ── Helpers date (fuseau Europe/Paris, format YYYY-MM-DD) ──
function ymd(d = new Date()) {
  // en-CA renvoie directement AAAA-MM-JJ
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}
function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

// ── Helpers KV (lecture/écriture JSON) ──
async function kvGet(env, key, fallback) {
  const v = await env.SHUTDOWN_KV.get(key);
  return v ? JSON.parse(v) : fallback;
}
async function kvPut(env, key, val) {
  await env.SHUTDOWN_KV.put(key, JSON.stringify(val));
}

// ── Helper API Telegram ──
async function tg(env, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}

// ── Envoi du rituel (déclenché par le cron ou par /shutdown) ──
async function startRitual(env, chatId) {
  await kvPut(env, 'state:' + chatId, { step: 1, date: ymd() });
  await tg(env, 'sendMessage', {
    chat_id: chatId,
    text: '🌙 Shutdown 00h30 — on ferme la journée.\n\n1/3 · Tes 3 priorités du jour, tu les as faites ?',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Oui', callback_data: 'q1:oui' },
        { text: '⚠️ Partiel', callback_data: 'q1:partiel' },
        { text: '❌ Non', callback_data: 'q1:non' },
      ]],
    },
  });
}

// ── Clic sur un bouton (réponses 1 et 2) ──
async function onCallback(env, cq) {
  const chatId = String(cq.message.chat.id);
  await tg(env, 'answerCallbackQuery', { callback_query_id: cq.id });
  if (chatId !== String(env.CHAT_ID)) return;

  const st = await kvGet(env, 'state:' + chatId, null);
  if (!st) return;
  const data = cq.data || '';

  if (data.startsWith('q1:') && st.step === 1) {
    st.q1 = data.slice(3); st.step = 2;
    await kvPut(env, 'state:' + chatId, st);
    await tg(env, 'editMessageReplyMarkup', { chat_id: chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
    await tg(env, 'sendMessage', {
      chat_id: chatId,
      text: '2/3 · Journal de trading rempli ?',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Oui', callback_data: 'q2:oui' },
          { text: '❌ Non', callback_data: 'q2:non' },
          { text: '➖ Pas de marché', callback_data: 'q2:na' },
        ]],
      },
    });
  } else if (data.startsWith('q2:') && st.step === 2) {
    st.q2 = data.slice(3); st.step = 3;
    await kvPut(env, 'state:' + chatId, st);
    await tg(env, 'editMessageReplyMarkup', { chat_id: chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
    await tg(env, 'sendMessage', { chat_id: chatId, text: '3/3 · Écris LA priorité n°1 de demain (une phrase).' });
  }
}

// ── Message texte (commandes + réponse à la question 3) ──
async function onMessage(env, msg) {
  const chatId = String(msg.chat.id);
  const text = (msg.text || '').trim();

  // /start : renvoie le CHAT_ID — autorisé à tous (sert à l'installation)
  if (text === '/start' || text === '/chatid') {
    await tg(env, 'sendMessage', {
      chat_id: chatId,
      text: 'Ton CHAT_ID : ' + chatId + '\nAjoute-le comme secret CHAT_ID dans le Worker, puis tu es prêt.',
    });
    return;
  }

  // À partir d'ici, seul TON compte est traité
  if (chatId !== String(env.CHAT_ID)) return;

  if (text === '/shutdown') { await startRitual(env, chatId); return; }

  if (text === '/streak') {
    const s = await kvGet(env, 'streak', { count: 0, last: null });
    const p = await kvGet(env, 'tomorrow', null);
    await tg(env, 'sendMessage', {
      chat_id: chatId,
      text: '🔥 Streak : ' + s.count + ' jour' + (s.count > 1 ? 's' : '') + '.' + (p ? ('\n🎯 Prochaine priorité : ' + p.text) : ''),
    });
    return;
  }

  if (text === '/focus') {
    const p = await kvGet(env, 'tomorrow', null);
    await tg(env, 'sendMessage', {
      chat_id: chatId,
      text: p ? ('🎯 ' + p.text) : 'Aucune priorité enregistrée. Lance /shutdown ce soir.',
    });
    return;
  }

  // Sinon : si un rituel attend la priorité de demain, on la capture
  const st = await kvGet(env, 'state:' + chatId, null);
  if (st && st.step === 3 && text && !text.startsWith('/')) {
    await finalize(env, chatId, st, text);
  }
}

// ── Clôture : calcule le streak, logge la journée, confirme ──
async function finalize(env, chatId, st, priority) {
  const today = ymd();

  let s = await kvGet(env, 'streak', { count: 0, last: null });
  if (!s.last) {
    s = { count: 1, last: today };
  } else {
    const gap = daysBetween(s.last, today);
    if (gap === 0) { /* déjà logué aujourd'hui : on garde le compteur */ }
    else if (gap === 1) { s.count += 1; s.last = today; }
    else { s.count = 1; s.last = today; } // trou dans la série → on repart à 1
  }
  await kvPut(env, 'streak', s);
  await kvPut(env, 'log:' + today, { date: today, q1: st.q1, q2: st.q2, priority, at: new Date().toISOString() });
  await kvPut(env, 'tomorrow', { text: priority, date: today });
  await env.SHUTDOWN_KV.delete('state:' + chatId);

  const nudge = st.q1 === 'non'
    ? 'Demain tu boucles tes 3 priorités. '
    : (st.q1 === 'oui' ? 'Bien joué. ' : '');

  await tg(env, 'sendMessage', {
    chat_id: chatId,
    text:
      '✅ Journée fermée.\n' +
      '🔥 Streak : ' + s.count + ' jour' + (s.count > 1 ? 's' : '') + '.\n' +
      '🎯 Demain : ' + priority + '\n\n' +
      nudge + 'La constance bat le talent. Repose-toi.',
  });
}

export default {
  // Webhook Telegram + petite page de santé
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('Valmont shutdown bot — OK');
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      // Sécurité : Telegram renvoie le secret défini à setWebhook
      const sec = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (!env.WEBHOOK_SECRET || sec !== env.WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      let update;
      try { update = await request.json(); } catch (e) { return new Response('bad request', { status: 400 }); }
      try {
        if (update.callback_query) await onCallback(env, update.callback_query);
        else if (update.message) await onMessage(env, update.message);
      } catch (e) {
        // On avale l'erreur pour toujours répondre 200 (sinon Telegram réessaie en boucle)
      }
      return new Response('ok');
    }

    return new Response('not found', { status: 404 });
  },

  // Déclenchement quotidien (Cron Trigger)
  async scheduled(event, env, ctx) {
    if (env.CHAT_ID) ctx.waitUntil(startRitual(env, String(env.CHAT_ID)));
  },
};
