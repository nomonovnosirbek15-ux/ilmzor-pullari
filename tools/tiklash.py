#!/usr/bin/env python3
"""Ilmzor zaxira faylidan (ilmzor-zaxira-YYYY-MM-DD.json.gz yoki ilmzor-baho-zaxira-*.json)
Cloudflare D1 ga import qilinadigan SQL fayllar yasaydi.

Ishlatish:
  python3 tiklash.py ilmzor-zaxira-2027-03-01.json.gz
  -> baho.sql va bot.sql paydo bo'ladi, keyin:
  npx wrangler d1 execute <BAHO_DB_NOMI> --remote --file baho.sql
  npx wrangler d1 execute <BOT_DB_NOMI>  --remote --file bot.sql
Eslatma: zaxirada parollar yo'q — tiklangandan keyin rahbar /api/setup emas, xodimlarga
saytdagi «🔑 Yangi parol» orqali parol beriladi (rahbar parolini dasturchi D1 da yangilaydi).
"""
import gzip, json, sys

def lit(v):
    if v is None: return 'NULL'
    if isinstance(v, bool): return '1' if v else '0'
    if isinstance(v, (int, float)): return repr(v)
    return "'" + str(v).replace("'", "''") + "'"

def dump(tables, out):
    with open(out, 'w', encoding='utf-8') as f:
        for name, rows in tables.items():
            if not rows or name.startswith('sqlite') or name.startswith('_cf'): continue
            cols = list(rows[0].keys())
            for r in rows:
                f.write(f'INSERT OR REPLACE INTO "{name}" ({",".join(cols)}) VALUES ({",".join(lit(r.get(c)) for c in cols)});\n')
    print('yozildi:', out)

p = sys.argv[1]
raw = gzip.open(p).read() if p.endswith('.gz') else open(p, 'rb').read()
d = json.loads(raw)
if 'baho' in d:  # bot yuborgan kunlik zaxira
    if d['baho']: dump(d['baho']['tables'], 'baho.sql')
    dump(d['bot'], 'bot.sql')
else:            # saytdan yuklab olingan zaxira
    dump(d['tables'], 'baho.sql')
