import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

// ESM, like api/ask.js — Coin's package.json has "type": "module".
// Runs daily via Vercel Cron (see vercel.json). Same auth shape as
// WalkLog's api/send-reminder.js: Vercel sends Authorization: Bearer
// <CRON_SECRET> on cron-triggered requests once that env var is set.
function isAuthorized(req) {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return req.headers.authorization === `Bearer ${expected}`
}

// Bangkok time, not the server's UTC — Vercel runs in UTC, and the month
// boundary should match the one the app shows.
function bangkokToday() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// 90% and 100% are separate alerts, deduped separately. The 90% one keeps the
// plain category as its dedupe key (what rows sent before this change use);
// 100% gets a suffix, so no schema change is needed.
const OVER_SUFFIX = '::100'
const PAGE_SIZE = 1000

export default async function handler(req, res) {
  if (!isAuthorized(req)) { res.status(401).json({ error: 'unauthorized' }); return }

  const SUPA_URL = 'https://jpsisvaprkrcyvwnmasb.supabase.co'
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) { res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }); return }
  const supa = createClient(SUPA_URL, serviceKey)

  const vapidPublic = process.env.VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  const vapidSubject = process.env.VAPID_SUBJECT
  if (!vapidPublic || !vapidPrivate || !vapidSubject) { res.status(500).json({ error: 'VAPID keys not set' }); return }
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)

  const today = bangkokToday()
  const month = today.slice(0, 7)
  const monthStart = `${month}-01`

  const { data: subs, error: subsErr } = await supa.from('coin_push_subscriptions').select('*')
  if (subsErr) { res.status(500).json({ error: subsErr.message }); return }
  if (!subs?.length) { res.status(200).json({ sent: 0, note: 'no subscriptions' }); return }
  const userIds = [...new Set(subs.map(s => s.user_id))]

  const { data: budgets, error: budgetsErr } = await supa
    .from('coin_budgets').select('*').in('user_id', userIds).gt('monthly_limit', 0)
  if (budgetsErr) { res.status(500).json({ error: budgetsErr.message }); return }
  if (!budgets?.length) { res.status(200).json({ sent: 0, note: 'no budgets set' }); return }

  // Paged — Supabase returns at most 1000 rows per request. Up to today only,
  // so future-dated entries don't count toward this month's spend yet.
  const txns = []
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error: txnsErr } = await supa
      .from('coin_transactions')
      .select('user_id, category, amount')
      .in('user_id', userIds)
      .eq('type', 'expense')
      .gte('date', monthStart)
      .lte('date', today)
      .order('id')
      .range(start, start + PAGE_SIZE - 1)
    if (txnsErr) { res.status(500).json({ error: txnsErr.message }); return }
    txns.push(...data)
    if (data.length < PAGE_SIZE) break
  }

  // At most one 90% and one 100% alert per user/category/month — the dedupe
  // table's primary key enforces this, checked here before any web-push calls.
  const { data: alreadySent, error: sentErr } = await supa
    .from('coin_budget_alerts_sent').select('user_id, category').eq('month', month)
  if (sentErr) { res.status(500).json({ error: sentErr.message }); return }
  const alreadySentSet = new Set((alreadySent || []).map(a => `${a.user_id}::${a.category}`))

  const spendByKey = new Map()
  for (const t of txns) {
    const key = `${t.user_id}::${t.category}`
    spendByKey.set(key, (spendByKey.get(key) || 0) + Number(t.amount))
  }

  const toAlert = []
  for (const b of budgets) {
    const key = `${b.user_id}::${b.category}`
    const limit = Number(b.monthly_limit)
    if (limit <= 0) continue
    const pct = ((spendByKey.get(key) || 0) / limit) * 100
    if (pct < 90) continue
    const over = pct >= 100
    if (alreadySentSet.has(over ? key + OVER_SUFFIX : key)) continue
    // crossing 100% also marks 90% as done, so a later run never sends the
    // weaker "at 90%" message after "over budget"
    const dedupeKeys = over ? [b.category + OVER_SUFFIX, b.category] : [b.category]
    toAlert.push({ user_id: b.user_id, category: b.category, pct, over, dedupeKeys })
  }
  if (!toAlert.length) { res.status(200).json({ sent: 0, note: 'nothing new crossed 90% or 100% this month' }); return }

  const subsByUser = new Map()
  for (const s of subs) {
    if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, [])
    subsByUser.get(s.user_id).push(s)
  }

  let sent = 0, removed = 0
  const dedupeRows = []
  for (const alert of toAlert) {
    const userSubs = subsByUser.get(alert.user_id) || []
    if (!userSubs.length) continue
    const payload = JSON.stringify({
      title: 'Coin — Budget Alert',
      body: alert.over
        ? `${alert.category} is over budget this month (${Math.round(alert.pct)}%).`
        : `${alert.category} is at ${Math.round(alert.pct)}% of its budget this month.`,
    })

    let delivered = false
    for (const sub of userSubs) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
        sent++
        delivered = true
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await supa.from('coin_push_subscriptions').delete().eq('endpoint', sub.endpoint)
          removed++
        }
      }
    }
    if (delivered) for (const category of alert.dedupeKeys) dedupeRows.push({ user_id: alert.user_id, category, month })
  }

  if (dedupeRows.length) {
    await supa.from('coin_budget_alerts_sent').upsert(dedupeRows, { onConflict: 'user_id,category,month' })
  }

  res.status(200).json({ sent, removed, alerted: dedupeRows.length })
}
