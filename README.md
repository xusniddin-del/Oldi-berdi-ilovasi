# Oldi-Berdi — qarz daftari

Ma'lumotlar: Google Sheets (Apps Script orqali). Ilova: GitHub Pages.

## 1. Google Sheets (server)
1. sheets.google.com → Bo'sh jadval → nomini "Oldi-Berdi baza" qiling.
2. Kengaytmalar (Extensions) → Apps Script.
3. Code.gs ichidagi hamma narsani o'chirib, shu papkadagi Code.gs faylini to'liq qo'ying → Saqlash (💾).
4. Yuqoridagi ro'yxatdan `setup` ni tanlab ▶ Run bosing → ruxsat bering
   ("Advanced → Go to ... (unsafe)" chiqsa ham bosing — bu sizning o'z skriptingiz).
5. Deploy → New deployment → ⚙ → Web app:
   - Execute as: **Me**
   - Who has access: **Anyone**
   → Deploy → chiqqan **Web app URL** (…/exec) ni nusxalang.

## 2. GitHub (ilova)
1. github.com → New repository → nomi `oldi-berdi`, **Public** → Create.
2. "uploading an existing file" → shu papkadagi fayllarni sudrab tashlang
   (Code.gs va README.md shart emas) → Commit changes.
3. config.js faylini oching → ✏️ → qo'shtirnoq ichiga Web app URL ni qo'ying → Commit.
4. Settings → Pages → Branch: `main`, papka: `/ (root)` → Save.
5. 1–2 daqiqadan keyin ilova manzili: `https://<login>.github.io/oldi-berdi/`

## 3. Telefonga o'rnatish
- Android (Chrome): ⋮ → "Ilovani o'rnatish" / "Bosh ekranga qo'shish".
- iPhone (Safari): Ulashish ⎋ → "Ekranga qo'shish".

## Yangilash
Yangi versiyada index.html, sw.js va version.json ni GitHub'da almashtiring.
Ilova ochiq turganlarda «Yangilash» tugmasi chiqadi.
Code.gs o'zgarsa: Apps Script → Deploy → Manage deployments → ✏️ → Version: New version → Deploy (URL o'zgarmaydi).
