// その日ぶんの通知を送るところ。db と send を引数で受け取るのは、毎朝1回しか動かない処理を
// テストから直に呼べるようにするため（本番で間違いに気づくと次は1日後になる）。
const { eventsFor } = require('./anniversary');

// db: admin.firestore() 相当, send: (subscription, payload) => {ok, gone},
// today: 'YYYY-MM-DD'（日本時間）, deleteValue: FieldValue.delete()
async function runDaily(db, send, today, deleteValue) {
  const spaces = await db.collection('spaces').get();
  let sent = 0;
  let failed = 0;
  let dropped = 0;

  for (const doc of spaces.docs) {
    const data = doc.data() || {};
    const events = eventsFor(data.anniversary, today);
    if (!events.length) continue;
    const subs = data.push || {};
    const ids = Object.keys(subs);
    if (!ids.length) continue;

    const deadIds = [];
    for (const ev of events) {
      for (const id of ids) {
        const sub = subs[id];
        if (!sub || !sub.endpoint || !sub.p256dh || !sub.auth) continue;
        const res = await send(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          { title: ev.title, body: ev.body, tag: 'anniv-' + ev.type + '-' + today },
        );
        if (res.ok) sent += 1; else failed += 1;
        if (res.gone && deadIds.indexOf(id) < 0) deadIds.push(id);
      }
    }
    // 端末から消された購読は掃除する（翌日以降そこへ投げ続けない）
    if (deadIds.length) {
      const patch = {};
      deadIds.forEach((id) => { patch['push.' + id] = deleteValue; });
      await doc.ref.update(patch);
      dropped += deadIds.length;
    }
  }
  return { spaces: spaces.size, sent, failed, dropped };
}

module.exports = { runDaily };
