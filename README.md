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
Yerel `.env` değerleri, aynı isimdeki ortam değişkenlerinden önceliklidir.

Discord Developer Portal üzerinden:

1. Botu sunucuya `bot` ve `applications.commands` kapsamlarıyla davet edin.
2. Oyun kanalında kanalı görüntüleme, mesaj gönderme, bağlantı yerleştirme ve dosya ekleme izinlerini verin.
3. Sesli mod için hedef ses kanalında **Bağlan** ve **Konuş** izinlerini de verin.

Tahminler özel formlardan alınır; **Message Content Intent** gerekli değildir.

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

Her oyun tek bir ortak embed kullanır. Tur, ipuçları, cevap ve skorlar yeni mesaj göndermek yerine aynı panelde güncellenir.
**Formdan tahmin** modunda herkes **Tahmin Et** butonuyla kendine özel bir form açar. Cevap ve geri bildirim yalnızca ilgili oyuncuya görünür; kanala tahmin yazılmaz.
**Dört şıklı tahmin** modunda paneldeki seçeneklerden birini seçin.
Türkçe karakterler ve küçük yazım hataları tolere edilir. Şarkı modunda yalnızca sanatçı adı yeterli değildir; sanatçı ve şarkı adı birlikte, her iki sırada da yazılabilir.
İlk doğru cevap puanı kazanır. Önceki turdan veya bitmiş oyundan açık kalan formlar geçersizdir.

Form, dört şıklı ve sesli modlarda her tur 25 saniye sürer. Görsel 5 saniyede bir netleşir; seviye 5'ten 1'e doğru puan 50'den 10'a düşer.
Netleştir butonu seviyeyi bir kademe düşürür, turu atla butonu cevabı açar ve puan vermez.
Tur bitince zamanlayıcı durur ve paneldeki kontroller kapanır; eski turun buton ve formları yeni turu değiştirmez.
Oyun sonundaki tur sayısı yalnızca tamamlanan turları içerir; erken kapatılan tur bu sayıya eklenmez.

Şarkı görselleri temsili müzik kartlarıdır, orijinal albüm kapakları değildir.

## Sözlerle tahmin

Bir metin kanalında `/oyun` komutuyla **Şarkı ve Müzik** kategorisini ve **Sözlerle tahmin (süresiz)** modunu seçin.
Bu mod ses çalmaz; şarkı adını açılan sözlerden bulmaya dayanır.

İlk satırla başlanır, her 5 saniyede yeni bir satır açılır. **Söz Aç** butonu beklemeden bir sonraki satırı gösterir.
Yeni ipuçları turun değerini 50'den en az 10 puana düşürür. Tahminler aynı paneldeki **Tahmin Et** formundan alınır.
25 saniyelik sınır yoktur; doğru cevap gelmeden tur kendiliğinden ilerlemez.
Tüm farklı satırlar açıldığında sözler tekrarlanmaz, tur tahmin beklemeye devam eder.
**Turu Atla** ve **Bitir** kontrolleri kullanılabilir.

Sözler, başlık ve sanatçı eşleştirilerek [LRCLIB](https://lrclib.net/) üzerinden alınır; internet bağlantısı gerekir.
Uygun söz bulunmayan şarkılar seçilmez. Kaynak hatasında oturum kapanır.
Kaynak bağlantısı cevap açıklandıktan sonra gösterilir; sözler diske kaydedilmez.

## Sesli şarkı tahmini

Sesli mod için FFmpeg'in `libopus` desteğiyle PATH üzerinde bulunması gerekir.
Başka bir konumdaysa `.env` içinde `FFMPEG_PATH` değerini çalıştırılabilir dosyanın
tam yoluna ayarlayın. `@discordjs/voice` ve DAVE şifreleme bağımlılığı kurulumda gelir;
ayrıca Opus eklentisi kurmak gerekmez.

`/oyun` komutunda **Şarkı ve Müzik** kategorisini, **Sesli şarkı tahmini** modunu
ve isteğe bağlı `ses_kanali` seçeneğini seçin. Kanal seçilmezse katıldığınız ses
kanalı kullanılır. Ses kanalının sohbetindeki ortak panelde **Tahmin Et** butonuna basıp şarkı adını forma yazın.
Oyunu paneldeki **Bitir** butonuyla veya aynı kanalda `/bitir` komutuyla kapatabilirsiniz.

Bot iTunes Search API üzerinden başlık ve sanatçıyla eşleşen gerçek önizlemeleri
bulur ve en fazla 25 saniye çalar. Yanlış eser, farklı sanatçı ve uygun önizlemesi
olmayan sonuçlar kullanılmaz. Cevap açıklandığında Apple Music kaynak bağlantısı
gösterilir. Önizlemeler diske kaydedilmez.

Doğru cevap, tur atlama veya oyun sonu sesi durdurur. Oyun bitince bot ses
kanalından ayrılır. Aynı sunucuda aynı anda bir sesli oyun açılabilir.
Kanalda insan oyuncu yokken sesli oyun başlamaz. Son oyuncu çıkınca oyun kapanır ve bot sesten ayrılır; diğer botlar oyuncu sayılmaz.

Başlangıçta otomatik oyun açmak için `.env` içinde `VOICE_CHANNEL_ID` değerini
bir ses kanalı ID'sine ayarlayın; boş bırakılırsa yalnızca slash komutları beklenir.
Botun belirtilen sunucuya ekli olması ve kanal izinlerine sahip olması gerekir.
Kanal boşsa bot oyuncu bekler; ilk insan oyuncu katıldığında otomatik oyun başlar.

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
