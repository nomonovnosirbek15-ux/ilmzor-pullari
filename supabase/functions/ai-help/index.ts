// Ilmzor puli — AI yordamchi (Google Gemini, bepul tarif)
// Supabase > Edge Functions > "ai-help" nomi bilan joylanadi.
// Kerakli secret: GEMINI_API_KEY (Edge Functions > Secrets)
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const DAILY_LIMIT = 30; // o'quvchi uchun kuniga yangi AI so'rovlar (keshdagilar hisobga kirmaydi)
// Eslatma: Google eski modellarni yangi foydalanuvchilarga yopib boradi (404) — shuning uchun bir nechta zaxira.
const MODELS = [Deno.env.get('GEMINI_MODEL'), 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-flash-latest']
  .filter((m, i, arr) => m && arr.indexOf(m) === i) as string[];

function encodeBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (message: string, status = 400) => json({ error: message }, status);

const STYLE = `Sen o'zbek maktab o'quvchilariga (2-11-sinf) matematika va mantiqni o'rgatadigan mehribon, sabrli o'qituvchisan.
Faqat o'zbek tilida (lotin yozuvida), sodda va qisqa gaplar bilan yoz. LaTeX va markdown jadval ishlatma — oddiy matn:
×, ÷, ², ³, √, ½ kabi belgilar bilan yoz. Uzunlik birligini doim "cm", yuzani "kv cm" deb yoz ("sm" emas).`;

async function gemini(key: string, parts: unknown[], asJson: boolean) {
  // Bir model limitga yetsa yoki ishlamasa — keyingisini sinaydi (har bir modelning bepul limiti alohida)
  const errors: string[] = [];
  let limited = 0;
  const started = Date.now();
  for (const model of MODELS) {
    const left = 110000 - (Date.now() - started); // umumiy vaqt chegarasi (server 150 s dan keyin to'xtatadi)
    if (left < 8000) { errors.push('vaqt tugadi'); break; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(60000, left));
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        signal: ctrl.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: asJson ? 0.8 : 0.4, ...(asJson ? { responseMimeType: 'application/json' } : {}) },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error?.message || String(res.status);
        console.error(`gemini ${model} ${res.status}: ${msg}`);
        errors.push(`${model}: ${res.status} ${msg}`.slice(0, 200));
        if (res.status === 429) limited++;
        if (res.status === 400 && /API key|location/i.test(msg)) throw new Error('AI xatosi: ' + msg);
        continue;
      }
      const cand = data?.candidates?.[0];
      const text = (cand?.content?.parts || []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text || '').join('').trim();
      if (!text) {
        console.error(`gemini ${model} bo'sh javob: ${cand?.finishReason} ${JSON.stringify(data?.promptFeedback || {})}`);
        errors.push(`${model}: bo'sh javob (${cand?.finishReason || data?.promptFeedback?.blockReason || '?'})`);
        continue;
      }
      return text;
    } catch (e) {
      if ((e as Error).message.startsWith('AI xatosi')) throw e;
      console.error(`gemini ${model} tarmoq/vaqt: ${(e as Error).message}`);
      errors.push(`${model}: ${(e as Error).name === 'AbortError' ? 'javob juda kechikdi' : (e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  if (limited > 0 && errors.every((e) => / 429 | 404 /.test(e))) throw new Error("Bugungi bepul AI limiti tugadi. Ertaga yana urinib ko'ring");
  throw new Error('AI javob bermadi: ' + errors[errors.length - 1]);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const GEMINI = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI) return fail("AI hali ulanmagan (GEMINI_API_KEY kiritilmagan)", 503);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await db.auth.getUser(token);
    const uid = auth?.user?.id;
    if (!uid) return fail('Avval tizimga kiring', 401);

    const { assignment_id, question, mode, fresh } = await req.json();
    const q = Number(question);
    if (!assignment_id || !q || !['explain', 'similar'].includes(mode)) return fail("So'rov noto'g'ri");

    const { data: me } = await db.from('profiles').select('id,role,active').eq('id', uid).single();
    if (!me?.active) return fail("Ruxsat yo'q", 403);
    const { data: a } = await db.from('assignments').select('*').eq('id', assignment_id).single();
    if (!a || a.kind !== 'test') return fail('Test topilmadi', 404);
    if (q < 1 || q > a.question_count) return fail("Savol raqami noto'g'ri");
    if (!a.file_path) return fail("Bu testga fayl yuklanmagan — AI savolni o'qiy olmaydi");

    const isManager = me.role === 'admin' || (me.role === 'teacher' && a.created_by === uid);
    let studentAnswer = '';
    let reveal = isManager;
    if (!isManager) {
      if (me.role !== 'student') return fail("Ruxsat yo'q", 403);
      const { data: perm } = await db.from('settings').select('value').eq('key', 'ai_help').maybeSingle();
      if (perm && perm.value === false) return fail('AI yordamchi admin tomonidan yopilgan', 403);
      const { data: sees } = await db.rpc('student_sees_assignment', { p_assignment: a.id, p_student: uid });
      if (!sees) return fail('Test topilmadi', 404);
      const { data: sub } = await db.from('submissions').select('*').eq('assignment_id', a.id).eq('student_id', uid).maybeSingle();
      if (!sub) return fail('Avval testni ishlang');
      studentAnswer = (sub.answers || [])[q - 1] || '';
      const finished = (a.max_attempts != null && sub.attempts >= a.max_attempts) || (a.deadline && new Date(a.deadline) < new Date());
      reveal = !!(a.show_key && finished);
    }

    const { data: keyRow } = await db.from('assignment_keys').select('answers').eq('assignment_id', a.id).single();
    const correct = keyRow?.answers?.[q - 1] || '';
    const cacheKind = mode === 'explain' ? `explain:${studentAnswer || '-'}:${reveal ? 1 : 0}` : 'similar';

    if (!fresh) {
      const { data: hit } = await db.from('ai_cache').select('content').eq('assignment_id', a.id).eq('question', q).eq('kind', cacheKind).maybeSingle();
      if (hit) return json({ ...hit.content, cached: true });
    }

    // kunlik limit (faqat o'quvchilar uchun)
    if (me.role === 'student') {
      const day = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
      const { data: u } = await db.from('ai_usage').select('count').eq('user_id', uid).eq('day', day).maybeSingle();
      if ((u?.count || 0) >= DAILY_LIMIT) return fail(`Bugungi AI limiti tugadi (${DAILY_LIMIT} ta). Ertaga yana urinib ko'ring`, 429);
      await db.from('ai_usage').upsert({ user_id: uid, day, count: (u?.count || 0) + 1 });
    }

    const { data: file, error: fErr } = await db.storage.from('assignments').download(a.file_path);
    if (fErr || !file) return fail('Test faylini ochib bo\'lmadi', 500);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = (a.file_path.split('.').pop() || '').toLowerCase();
    const mime = a.file_type === 'pdf' || ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg';
    const filePart = { inline_data: { mime_type: mime, data: encodeBase64(bytes) } };

    let content: Record<string, unknown>;
    if (mode === 'explain') {
      const prompt = `${STYLE}

Ilova qilingan faylda test bor (variantlar: ${'ABCDEF'.slice(0, a.option_count).split('').join(', ')}). Undan ${q}-savolni top.
${studentAnswer ? `O'quvchi "${studentAnswer}" deb javob berdi — bu NOTO'G'RI.` : "O'quvchi bu savolga javob bermagan."}
To'g'ri javob: "${correct}" (bu ma'lumot faqat sen uchun).
${reveal
  ? "O'quvchiga to'g'ri javobni ham aytishing mumkin."
  : "MUHIM: to'g'ri javob harfini ham, yakuniy sonni ham AYTMA — o'quvchi o'zi topishi kerak. Faqat yo'l ko'rsat."}

Javobing tuzilishi:
1) "Savol:" — savolni qisqa qayta yoz.
2) "Qayerda adashding:" — o'quvchi nima uchun "${studentAnswer || '?'}" ni tanlagan bo'lishi mumkin (1-2 gap).
3) "Yechish yo'li:" — 3-5 ta qisqa qadam.
${reveal ? '4) "Javob:" — to\'g\'ri javob va qisqa tekshiruv.' : '4) "Endi o\'zing:" — oxirgi qadamni o\'quvchiga qoldir, rag\'batlantiruvchi bitta gap.'}
Agar faylda ${q}-savolni topa olmasang, faqat shuni yoz: "Savolni fayldan topa olmadim".
Jami 180 so'zdan oshmasin.`;
      const text = await gemini(GEMINI, [filePart, { text: prompt }], false);
      content = { text };
    } else {
      const prompt = `${STYLE}

Ilova qilingan fayldagi testdan ${q}-savolni top. Shu savol bilan BIR XIL mavzu va qiyinlikdagi, lekin sonlari va sharti boshqa bo'lgan 3 ta YANGI test savoli tuz.
Har birida 4 ta variant bo'lsin, faqat bittasi to'g'ri. Javoblarni o'zing hisoblab tekshir — xato bo'lmasin.
Faqat quyidagi JSON ni qaytar:
{"topic":"mavzu nomi (2-4 so'z)","problems":[{"q":"savol matni","options":["...","...","...","..."],"answer":0,"why":"1-2 gapli qisqa yechim"}]}
"answer" — to'g'ri variantning 0 dan boshlangan tartib raqami.
Agar savolni topa olmasang: {"error":"Savolni fayldan topa olmadim"}`;
      const raw = await gemini(GEMINI, [filePart, { text: prompt }], true);
      let parsed: { topic?: string; problems?: { q: string; options: string[]; answer: number; why: string }[]; error?: string };
      try { parsed = JSON.parse(raw.replace(/^```(json)?|```$/g, '').trim()); } catch { return fail("AI javobini o'qib bo'lmadi. Qayta urinib ko'ring", 502); }
      if (parsed.error) return fail(parsed.error, 422);
      const problems = (parsed.problems || [])
        .filter((p) => p && p.q && Array.isArray(p.options) && p.options.length >= 2 && Number.isInteger(p.answer) && p.answer >= 0 && p.answer < p.options.length)
        .slice(0, 5);
      if (!problems.length) return fail("AI misol tuza olmadi. Qayta urinib ko'ring", 502);
      content = { topic: parsed.topic || '', problems };
    }

    await db.from('ai_cache').upsert({ assignment_id: a.id, question: q, kind: cacheKind, content });
    return json(content);
  } catch (e) {
    console.error('ai-help xato:', (e as Error).message);
    return fail((e as Error).message || 'Xatolik', 500);
  }
});
