# sarki-tahmin

Discord için şarkı, bayrak ve Minecraft eşya tahmin botu. Bun ve TypeScript ile çalışır; puanları yerel SQLite veritabanında tutar.

## Kurulum

Bun 1.4.2 veya üzeri gerekir. CI, Windows ve Linux üzerinde kurulum, tip kontrolü ve testleri çalıştırır.

```sh
bun install --frozen-lockfile
cp .env.example .env
```

PowerShell'de dosyayı kopyalamak için `Copy-Item .env.example .env` kullanabilirsiniz.
`.env` içindeki `DISCORD_TOKEN` değerini kendi bot tokeninizle değiştirin. Tokeni paylaşmayın veya repoya eklemeyin.

Discord Developer Portal üzerinden:

1. Uygulamanın **Bot** sayfasında **Message Content Intent** seçeneğini açın. Sohbet tahminleri için gereklidir.
2. Botu sunucuya `bot` ve `applications.commands` kapsamlarıyla davet edin.
3. Oyun kanalında kanalı görüntüleme, mesaj gönderme, bağlantı yerleştirme ve dosya ekleme izinlerini verin.

```sh
bun start
```

Komutlar bot bağlandıktan sonra otomatik kaydedilir. Sunucu metin kanalında `/oyun` ile başlayın; global komutların Discord'da görünmesi biraz zaman alabilir.

## Oynanış

`/oyun` komutunda kategori, mod ve 3–30 arasında tur sayısı seçilir. Varsayılan tur sayısı 10'dur.

- **Şarkı:** Müzik türü, yıl, maskelenmiş sanatçı adı ve söz ipuçlarından şarkının adını bulun. Son seviyede sanatçı açık gösterilir.
- **Bayrak:** Bulanık görselden ülkeyi bulun.
- **Minecraft:** Görseldeki eşyanın adını bulun.
- **Karışık:** Bu üç kategori arasından rastgele tur açılır.

Sohbet modunda cevabı kanala yazın; buton modunda dört seçenekten birini seçin. Türkçe karakterler ve küçük yazım hataları tolere edilir.
Şarkı modunda yalnızca sanatçı adı yeterli değildir. Sanatçı ve şarkı adı birlikte, her iki sırada da yazılabilir.

Her tur 25 saniye sürer. Görsel 5 saniyede bir netleşir; seviye 5'ten 1'e doğru puan 50'den 10'a düşer.
Netleştir butonu seviyeyi bir kademe düşürür, turu atla butonu cevabı açar ve puan vermez.
Tur bitince zamanlayıcı ve buton dinleyicisi kapatılır; eski turun etkileşimleri yeni turu değiştirmez.

Şarkı modu metin ve görsel ipuçlarıyla oynanır; sesli kanala bağlanmaz ve müzik çalmaz.
Şarkı görselleri temsili müzik kartlarıdır, orijinal albüm kapakları değildir.

## Komutlar

- `/oyun` — Yeni oyun başlatır.
- `/bitir` — Kanaldaki oyunu sonlandırır.
- `/sıralama` — Sunucu liderlik tablosunu gösterir.
- `/profil` — Oyuncunun puan ve tahmin istatistiklerini gösterir.
- `/yardım` — Kuralları ve puanlamayı gösterir.

## Geliştirme

```sh
bun run dev
bun run typecheck
bun test
```

Şarkı verileri `data/songs.json`, kart üreticisi `scripts/generateSongAssets.ts` içindedir.
Veri setini değiştirdikten sonra kartları yeniden üretin:

```sh
bun run generate:assets
```

İstatistikler `data/stats.db` içinde saklanır ve Git'e dahil edilmez. Botu başka bir makineye taşırken bu dosyayı ayrıca yedekleyin; açık veritabanını kopyalamadan önce botu durdurun.
