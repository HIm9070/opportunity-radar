// يقرأ النسخة العامة لقناة تلجرام ويستخرج الفرص بقواعد ثابتة (بدون ذكاء اصطناعي)
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const CHANNEL = 'hakathonat';
const OUT = 'data/opportunities.json';
const MAX_PAGES = 8;
const UA = 'Mozilla/5.0 (compatible; OpportunityRadar/1.0)';

const MONTHS = { 'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'ابريل': 4, 'إبريل': 4, 'مايو': 5, 'يونيو': 6, 'يوليو': 7, 'أغسطس': 8, 'اغسطس': 8, 'سبتمبر': 9, 'أكتوبر': 10, 'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12 };
const MR = '(' + Object.keys(MONTHS).join('|') + ')';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const norm = (s) => s
  .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
  .replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d))
  .replace(/[۰-۹]/g, (d) => FA_DIGITS.indexOf(d));

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => (m < 1 || m > 12 || d < 1 || d > 31) ? null : `${y}-${pad(m)}-${pad(d)}`;

// يستخرج كل التواريخ من نص، ويستنتج السنة من تاريخ نشر الرسالة لو غابت
export function findDates(raw, ref) {
  let t = norm(raw);
  const out = [];
  const yearFor = (m, d, y) => {
    if (y) return +y;
    let yy = ref.getUTCFullYear();
    if (new Date(Date.UTC(yy, m - 1, d)) < ref - 30 * 864e5) yy++;
    return yy;
  };
  const push = (y, m, d) => { const s = iso(yearFor(m, d, y), m, d); if (s) out.push(s); };

  t = t.replace(/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4})/g, (_, d, m, y) => { push(y, +m, +d); return ' '; });
  t = t.replace(new RegExp(`(\\d{1,2})\\s*(?:[–—\\-]|إلى|الى|حتى|و)\\s*(\\d{1,2})\\s*${MR}\\s*(\\d{4})?`, 'g'),
    (_, a, b, mn, y) => { push(y, MONTHS[mn], +a); push(y, MONTHS[mn], +b); return ' '; });
  t = t.replace(new RegExp(`(\\d{1,2})\\s*${MR}\\s*(\\d{4})?`, 'g'),
    (_, d, mn, y) => { push(y, MONTHS[mn], +d); return ' '; });
  return out.sort();
}

export function parseReg(text, ref) {
  const t = norm(text);
  const i = t.search(/يغلق|ينتهي|حتى|آخر موعد|اخر موعد/);
  const ds = findDates(i >= 0 ? t.slice(i) : t, ref);
  return { open: /مفتوح/.test(t), closes: ds.length ? ds[ds.length - 1] : null };
}

const LABELS = [
  ['tracks', /^(?:مسارات\s*(?:الهاكاثون|الهاكثون|المبادرة|المسابقة|التحدي|الفعالية)?|المسارات)/],
  ['eventDate', /^موعد\s*(?:الهاكاثون|الهاكثون|المسابقة|المبادرة|الفعالية|التحدي|المعسكر|الحدث)/],
  ['mode', /^حضوري\s*(?:او|أو)\s*عن\s*بعد/],
  ['reg', /^موعد\s*التسجيل/],
  ['link', /^التسجيل\s*(?:و|ـ)?\s*التفاصيل/],
  ['prize', /^الجوائز/],
  ['price', /^سعر\s*المشاركة/],
];

function labelOf(line) {
  const clean = line.replace(/^[\s\-•*·🔹🔸📅📍🏆🗓️]+/u, '');
  for (const [key, re] of LABELS) {
    const m = clean.match(new RegExp(re.source + '\\s*[:：]\\s*(.*)$'));
    if (m) return { key, rest: m[1].trim() };
  }
  return null;
}

export function parseMessage(text, links, id, posted) {
  const ref = posted ? new Date(posted) : new Date();
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/^https?:\/\/t\.me\/hakathonat\S*$/.test(l));
  if (!lines.length) return null;

  const fields = {};
  const desc = [];
  let cur = null;
  for (let i = 1; i < lines.length; i++) {
    const lb = labelOf(lines[i]);
    if (lb) { cur = lb.key; fields[cur] = fields[cur] || []; if (lb.rest) fields[cur].push(lb.rest); }
    else if (cur) fields[cur].push(lines[i]);
    else desc.push(lines[i]);
  }
  // لازم يكون إعلان فرصة: فيه موعد تسجيل أو رابط تسجيل
  if (!fields.reg && !fields.link) return null;

  const titleParts = lines[0].split('|').map((s) => s.trim());
  const name = titleParts[0];
  let city = titleParts[1] || '';

  const modeText = (fields.mode || []).join(' ');
  const hasOn = /حضوري/.test(modeText), hasOff = /عن\s*بعد/.test(modeText);
  const mode = hasOn && hasOff ? 'حضوري وعن بعد' : hasOff ? 'عن بعد' : hasOn ? 'حضوري' : '';
  if (!city) { const m = modeText.match(/في\s+(\S+(?:\s\S+)?)/); if (m) city = m[1]; }

  const eventText = (fields.eventDate || []).join(' ، ');
  const evDates = findDates(eventText, ref);
  const reg = parseReg((fields.reg || []).join(' '), ref);
  const eventEnd = evDates.length ? evDates[evDates.length - 1] : null;

  const link = links.find((h) => /^https?:\/\//.test(h) && !/t\.me\/hakathonat/.test(h)) || null;

  return {
    id: String(id),
    name,
    city,
    mode,
    summary: desc.join(' ').slice(0, 280),
    tracks: (fields.tracks || []).slice(0, 8),
    eventText: eventText.slice(0, 200),
    eventStart: evDates[0] || null,
    eventEnd,
    regText: (fields.reg || []).join(' ').slice(0, 120),
    closes: reg.closes,
    until: reg.closes || eventEnd || null,
    prize: (fields.prize || []).join(' ').slice(0, 200),
    link,
    tgUrl: `https://t.me/${CHANNEL}/${id}`,
    posted: posted || null,
  };
}

const dec = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export function parsePage(html) {
  const out = [];
  const parts = html.split('tgme_widget_message_wrap').slice(1);
  for (const p of parts) {
    const id = (p.match(/data-post="[^"]+\/(\d+)"/) || [])[1];
    if (!id) continue;
    const posted = (p.match(/<time[^>]*datetime="([^"]+)"/) || [])[1] || null;
    const m = p.match(/class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/);
    out.push({ id: +id, posted, html: m ? m[1] : null });
  }
  return out;
}

function toText(h) {
  const links = [];
  let s = h.replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, txt) => { links.push(dec(href)); return txt; });
  s = s.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '');
  return { text: dec(s), links };
}

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'ar' } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.text();
}

async function main() {
  let existing = { items: [] };
  try { existing = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
  const byId = new Map((existing.items || []).map((i) => [i.id, i]));

  const pages = [];
  if (process.env.FIXTURE) {
    pages.push(await readFile(process.env.FIXTURE, 'utf8'));
  } else {
    let url = `https://t.me/s/${CHANNEL}`;
    for (let n = 0; n < MAX_PAGES; n++) {
      const html = await get(url);
      pages.push(html);
      const ids = parsePage(html).map((m) => m.id);
      if (!ids.length) break;
      const min = Math.min(...ids);
      if (min <= 1) break;
      url = `https://t.me/s/${CHANNEL}?before=${min}`;
    }
  }

  let seen = 0, found = 0;
  for (const html of pages) {
    for (const msg of parsePage(html)) {
      seen++;
      if (!msg.html) continue;
      const { text, links } = toText(msg.html);
      let item = null;
      try { item = parseMessage(text, links, msg.id, msg.posted); } catch (e) { console.warn('تعذر قراءة الرسالة', msg.id, e.message); }
      if (item) { byId.set(item.id, item); found++; }
    }
  }
  if (!seen) throw new Error('ما وصلت أي رسائل من القناة، لن أغيّر الملف.');

  const cutoff = Date.now() - 365 * 864e5;
  const items = [...byId.values()]
    .filter((i) => !i.posted || new Date(i.posted) > cutoff)
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, 300);

  await mkdir('data', { recursive: true });
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), items }, null, 2) + '\n');
  console.log(`قُرئت ${seen} رسالة، واستُخرجت ${found} فرصة، والمجموع المحفوظ ${items.length}`);
}

if (process.argv[1] && process.argv[1].endsWith('update.mjs')) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
