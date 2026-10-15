# sarki-tahmin

Discord uzerinde calisan kademeli sarkı ve gorsel tahmin oyunu botu. Bun ve TypeScript ile gelistirilmistir.

## Ozellikler

- Sarki Tahmin Modu: Album kapaklari, muzik turu, cikis yili, sanatci ve sarki sozu ipuclari ile kademeli tahmin.
- Bayrak ve Minecraft Modlari: Ulke bayraklari ve Minecraft esyalari icin kademeli blur tahmin mekanigi.
- Iki Oyun Modu: Sohbete dogrudan metin yazarak veya 4 sikli Discord butonlari ile coktan secmeli tahmin.
- Akilli Eslesme: Turkce karakter normalizasyonu, kucuk yazim hatalarini tolere eden benzerlik algoritmasi.
- Istatistik ve Siralama: SQLite tabanli kullanici profilleri, puanlama ve sunucu liderlik tablosu.

Şarkı modunda cevap şarkının adıdır; yalnızca sanatçı adı puan kazandırmaz.
Sanatçı ve şarkı adı birlikte, her iki sırada da yazılabilir.

Her turun ayrı zamanlayıcısı vardır. Tur bitince zamanlayıcı ve buton dinleyicisi
kapatılır; önceki turdan geciken etkileşimler yeni turun puanını değiştirmez.

## Gereksinimler

- Bun (v1.2 veya uzeri)
- Discord Bot Token

## Kurulum

1. Bagimliliklari yukleyin:

```bash
bun install
```

2. `.env` dosyasini olusturun ve bot tokeninizi girin:

```bash
cp .env.example .env
```

3. Botu baslatin:

```bash
bun start
```

Gelistirme modunda dosya degisikliklerini izleyerek calistirmak icin:

```bash
bun run dev
```

## Testler

Birim ve entegrasyon testlerini calistirmak icin:

```bash
bun test
```

Tip kontrolu icin:

```bash
bun run typecheck
```

## Komutlar

- `/oyun` - Kategori (sarki, bayrak, minecraft, karisik), oyun modu ve tur sayisi secerek oyunu baslatir.
- `/bitir` - Kanalda devam eden oyunu sonlandirir.
- `/siralama` - Sunucunun en yuksek puanli oyuncularini listeler.
- `/profil` - Oyuncunun skor, basari ve kategori istatistiklerini gosterir.
- `/yardim` - Kademeli puanlama sistemi ve oyun rehberini gosterir.
