<p align="center">
  <a href="https://github.com/rebeccapanel/Rebecca" target="_blank" rel="noopener noreferrer">
    <img width="160" height="160" src="../dashboard/src/assets/logo.svg" alt="Rebecca logo">
  </a>
</p>

<h1 align="center"/>رِبِکا</h1>

<p align="center">
     راه حل یکپارچه برای مدیریت پروتکل های مختلف. قدرت گرفته از <a href="https://github.com/XTLS/Xray-core">Xray</a>
</p>

<br/>
<p align="center">
  <a href="#">
    <img src="https://img.shields.io/github/actions/workflow/status/rebeccapanel/Rebecca/build.yml?style=flat-square" />
  </a>
  <a href="https://hub.docker.com/r/rebeccapanel/rebecca" target="_blank">
    <img src="https://img.shields.io/docker/pulls/rebeccapanel/rebecca?style=flat-square&logo=docker" />
  </a>
  <a href="#">
    <img src="https://img.shields.io/github/license/rebeccapanel/Rebecca?style=flat-square" />
  </a>
  <a href="https://t.me/rebeccapanel_rebecca" target="_blank">
    <img src="https://img.shields.io/badge/telegram-channel-blue?style=flat-square&logo=telegram" />
  </a>
  <a href="#">
    <img src="https://img.shields.io/github/stars/rebeccapanel/Rebecca?style=social" />
  </a>
</p>

<p align="center">
	<a href="../README.md">
	English
	</a>
	/
	<a href="./README-fa.md">
	فارسی
	</a>
  /
  <a href="./README-zh-cn.md">
	简体中文
	</a>
   /
  <a href="./README-ru.md">
 Русский
 </a>
</p>

## فهرست مطالب
- [بررسی اجمالی](#بررسی-اجمالی)
  - [چرا رِبِکا؟](#چرا-رِبِکا)
    - [امکانات](#امکانات)
- [راهنمای نصب](#راهنمای-نصب)
- [تنظیمات](#تنظیمات)
- [ربات تلگرام](#ربات-تلگرام)
- [ارسال اعلان‌ها به آدرس وبهوک](#ارسال-اعلانها-به-آدرس-وبهوک)
- [کمک مالی](#کمک-مالی)
- [لایسنس](#لایسنس)
- [مشارکت در توسعه](#مشارکت-در-توسعه)


# بررسی اجمالی

رِبِکا یک نرم‌افزار (وب‌اپلیکیشن) مدیریت پروکسی است که امکان مدیریت چندصد حساب پروکسی را با سادگی و قدرت بالا فراهم می‌کند. رِبِکا از [Xray-core](https://github.com/XTLS/Xray-core) قدرت گرفته و با بک‌اند Go و داشبورد React پیاده‌سازی شده است.

## چرا رِبِکا؟

رِبِکا دارای یک رابط کاربری ساده و در عین حال پرامکانات است. رِبِکا امکان ایجاد چند نوع پروکسی برای کاربران را فراهم می‌کند بدون اینکه به تنظیمات پیچیده نیاز داشته باشید. با رابط کاربری تحت وب، می‌توانید کاربران را مانیتور، ویرایش و در صورت نیاز محدود کنید.

### امکانات

- **رابط کاربری تحت وب** آماده
- به صورت **REST API** پیاده سازی شده
- پشتیبانی از پروتکل های **Vmess**, **VLESS**, **Trojan** و **Shadowsocks**
- امکان فعالسازی **چندین پروتکل** برای هر یوزر
- امکان ساخت **چندین کاربر** بر روی یک inbound
- پشتیبانی از **چندین inbound** بر روی **یک port** (به کمک fallbacks)
- محدودیت بر اساس مصرف **ترافیک** و **تاریخ انقضا**
- محدودیت **ترافیک دوره ای** (به عنوان مثال روزانه، هفتگی و غیره)
- پشتیبانی از **Subscription link** سازگار با **V2ray** _(مثل نرم افزار های V2RayNG, SingBox, Nekoray و...)_ و **Clash**
- ساخت **لینک اشتراک گذاری** و **QRcode** به صورت خودکار
- مانیتورینگ منابع سرور و **مصرف ترافیک**
- پشتیبانی از تنظیمات xray
- پشتیبانی از **TLS**
- **ربات تلگرام**
- **رابط خط فرمان (CLI)** داخلی
- قابلیت ایجاد **چندین مدیر** (تکمیل نشده است)

# راهنمای نصب

برای نصب باینری Master رِبِکا:

```bash
curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/master/scripts/rebecca/rebecca-binary.sh | sudo bash -s -- install
```

نصاب‌ها را با `sudo bash -c "$(curl ...)"` اجرا نکنید؛ متن اسکریپت ممکن است از محدودیت single argument لینوکس بزرگ‌تر شود و خطای `Argument list too long` بدهد. همیشه دانلود را مثل نمونه بالا به `sudo bash -s --` pipe کنید.

برای نصب کانال dev:

```bash
curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca-binary.sh | sudo bash -s -- install --dev
```

برای نصب باینری Rebecca-node روی هر سرور نود:

```bash
curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/master/scripts/rebecca/rebecca-node-binary.sh | sudo bash -s -- install
```

نصاب‌های باینری سرویس native systemd می‌سازند و asset مناسب معماری سرور را خودکار دانلود می‌کنند. Master دیتابیس‌های SQLite، MySQL و MariaDB را از طریق گزینه‌های نصب پشتیبانی می‌کند؛ نصاب نود فقط runtime نود را نصب می‌کند و اتصال آن به Master از طریق certificate/token داخل پنل انجام می‌شود.

وقتی نصب تمام شد:

- شما لاگ های رِبِکا رو مشاهده میکنید که می‌توانید با بستن ترمینال یا فشار دادن `Ctrl+C` از آن خارج شوید
- فایل‌های رِبِکا در پوشه `/opt/rebecca` قرار می‌گیرند
- فایل تنظیمات در مسیر `/opt/rebecca/.env` قرار می‌گیرد ([تنظیمات](#تنظیمات) را مشاهده کنید)
- فایل‌های مهم رِبِکا در مسیر `/var/lib/rebecca` قرار می‌گیرند
به دلایل امنیتی، داشبورد رِبِکا از طریق آی‌پی قابل دسترسی نیست. بنابراین باید برای دامنه خود گواهی SSL تهیه کنید و از طریق آدرس https://YOUR_DOMAIN:8000/dashboard/ وارد داشبورد شوید (نام دامنه خود را جایگزین YOUR_DOMAIN کنید)
- همچنین می‌توانید از فوروارد کردن پورت SSH برای دسترسی لوکال به داشبورد رِبِکا بدون دامنه استفاده کنید. نام کاربری و آیپی سرور خود را جایگزین `user@serverip` کنید و دستور زیر را اجرا کنید:

```bash
ssh -L 8000:localhost:8000 user@serverip
```

در نهایت، می‌توانید لینک زیر را در مرورگر خود وارد کنید تا به داشبورد رِبِکا دسترسی پیدا کنید:

http://localhost:8000/dashboard/

به محض بستن ترمینال SSH، دسترسی شما به داشبورد قطع خواهد شد. بنابراین، این روش تنها برای تست  کردن توصیه می‌شود.

در مرحله بعد، باید یک ادمین سودو بسازید

```bash
rebecca cli admin create --sudo
```

تمام! حالا با این اطلاعات می‌توانید وارد رِبِکا شوید

برای مشاهده راهنمای اسکریپت رِبِکا دستور زیر را اجرا کنید

```bash
rebecca --help
```

اگر مشتاق هستید که رِبِکا را از سورس و به صورت دستی اجرا کنید، مراحل زیر را مشاهده کنید
<details markdown="1">
<summary><h3>نصب به صورت دستی (پیچیده)</h3></summary>

لطفا xray را نصب کنید.
شما میتواند به کمک [Xray-install](https://github.com/XTLS/Xray-install) این کار را انجام دهید.

```bash
curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh | bash -s -- install
```

پروژه را clone کنید و داشبورد و باینری‌های Go را بسازید.

```bash
git clone https://github.com/rebeccapanel/Rebecca.git
cd Rebecca
cd dashboard
npm ci
VITE_BASE_API=/api/ npm run build -- --outDir=build --assetsDir=statics
cp ./build/index.html ./build/404.html
cd ..
bash scripts/build_binary.sh
```

سپس کامند زیر را اجرا کنید تا migrationهای Go دیتابیس اجرا شوند.

```bash
rebecca migrate up
```

اگر می‌خواهید از CLI استفاده کنید، می‌توانید فایل `Go CLI` موجود را به نام اجرایی جدید لینک کنید و تکمیل خودکار آن را نصب کنید:

```bash
sudo install -m 755 ./dist/rebecca-cli /usr/local/bin/rebecca
rebecca cli --help

```

حالا یک کپی از `.env.example` با نام `.env` بسازید و با یک ادیتور آن را باز کنید و تنظیمات دلخواه خود را انجام دهید. یه عنوان مثال نام کاربری و رمز عبور را می توانید در این فایل تغییر دهید.

```bash
cp .env.example .env
nano .env
```

> برای اطلاعات بیشتر بخش [تنظیمات](#تنظیمات) را مطالعه کنید.

در انتها، رِبِکا را به کمک دستور زیر اجرا کنید.

```bash
./dist/rebecca-server
```

برای نصب دستی با systemd، یک unit برای باینری Go بسازید:

```ini
[Unit]
Description=Rebecca
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/rebecca
EnvironmentFile=/opt/rebecca/.env
ExecStart=/opt/rebecca/dist/rebecca-server
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

سپس آن را فعال کنید:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rebecca
```

اجرا با nginx
```
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name  example.com;

    ssl_certificate      /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key  /etc/letsencrypt/live/example.com/privkey.pem;

  location ~* /(dashboard|statics|sub|api|docs|redoc|openapi.json) {
        proxy_pass http://0.0.0.0:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```
or
```
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
  server_name  rebecca.example.com;

    ssl_certificate      /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key  /etc/letsencrypt/live/example.com/privkey.pem;

    location / {
        proxy_pass http://0.0.0.0:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

به صورت پیش‌فرض رِبِکا در آدرس `http://localhost:8000/dashboard` اجرا می‌شود. شما می‌توانید با تغییر `UVICORN_HOST` و `UVICORN_PORT` هاست و پورت را تغییر دهید.
</details>

# تنظیمات

> متغیر های زیر در فایل ‍`env` یا `.env` استفاده میشوند. شما می توانید با تعریف و تغییر آن ها، تنظیمات رِبِکا را تغییر دهید.

| توضیحات | متغیر |
| ---: | :---: |
| نام کاربری ادمین اولیه | SUDO_USERNAME |
| رمز عبور ادمین اولیه | SUDO_PASSWORD |
| آدرس دیتابیس؛ این نام legacy برای سازگاری با runtime جدید Go حفظ شده است | SQLALCHEMY_DATABASE_URL |
| هاست gateway گو (پیش‌فرض: `0.0.0.0`) | UVICORN_HOST |
| پورت gateway گو (پیش‌فرض: `8000`) | UVICORN_PORT |
| مسیر گواهی TLS برای gateway گو | UVICORN_SSL_CERTFILE |
| مسیر کلید TLS برای gateway گو | UVICORN_SSL_KEYFILE |
| نوع CA برای اسکریپت‌های نصب: `public` یا `private` | UVICORN_SSL_CA_TYPE |
| آدرس کامل gateway؛ مقدار `UVICORN_HOST` و `UVICORN_PORT` را override می‌کند | REBECCA_GATEWAY_ADDR |
| فاصله پردازش صف node operations | REBECCA_NODE_OPERATIONS_POLL_INTERVAL |
| فاصله بررسی lifecycle کاربران | REBECCA_USER_LIFECYCLE_INTERVAL |
| فاصله reset دوره‌ای مصرف کاربران | REBECCA_USER_USAGE_RESET_INTERVAL |
| حذف خودکار کاربران منقضی پس از این تعداد روز؛ مقدار منفی یعنی غیرفعال | USERS_AUTODELETE_DAYS |
| شامل کردن کاربران limited در حذف خودکار | USER_AUTODELETE_INCLUDE_LIMITED_ACCOUNTS |
| زمان انقضای JWT access token بر حسب دقیقه | JWT_ACCESS_TOKEN_EXPIRE_MINUTES |
| timeout لیست بزرگ کاربران؛ مقدار `0` یعنی غیرفعال | USERS_LIST_TIMEOUT_SECONDS |
| مسیر پایه certificateهای مدیریت‌شده | REBECCA_CERT_BASE |
| ریشه configهایی که در full backup قرار می‌گیرند | REBECCA_CONFIG_DIR |


# ربات تلگرام
رِبِکا دارای یک ربات تلگرام داخلی است که می‌تواند مدیریت سرور، ایجاد و حذف کاربر و ارسال اعلان‌ها را انجام دهد. این ربات را می‌توان با چند مرحله ساده فعال کرد.

برای فعال کردن ربات تلگرام:

1. در تنظیمات، متغیر`TELEGRAM_API_TOKEN` را به API TOKEN ربات تلگرام خود تنظیم کنید.
2. همینطور، متغیر`TELEGRAM_ADMIN_ID` را به شناسه عددی حساب تلگرام خود تنظیم کنید. شما می‌توانید شناسه خود را از [@userinfobot](https://t.me/userinfobot) دریافت کنید.


# ارسال اعلان‌ها به آدرس وبهوک
شما می‌توانید آدرسی را برای رِبِکا فراهم کنید تا تغییرات کاربران را به صورت اعلان برای شما ارسال کند.

اعلان‌ها به صورت یک درخواست POST به آدرسی که در `WEBHOOK_ADDRESS` فراهم شده به همراه مقدار تعیین شده در `WEBHOOK_SECRET` به عنوان `x-webhook-secret` در header درخواست ارسال می‌شوند.

نمونه‌ای از درخواست ارسال شده توسط رِبِکا:

```
Headers:
Host: 0.0.0.0:9000
User-Agent: python-requests/2.28.1
Accept-Encoding: gzip, deflate
Accept: */*
Connection: keep-alive
x-webhook-secret: something-very-very-secret
Content-Length: 107
Content-Type: application/json



Body:
{"username": "rebecca_test_user", "action": "user_updated", "enqueued_at": 1680506457.636369, "tries": 0}
```

انواع مختلف actionهایی که رِبِکا ارسال می‌کند: `user_created`, `user_updated`, `user_deleted`, `user_limited`, `user_expired`, `user_disabled`, `user_enabled`


# کمک مالی
اگر رِبِکا را برای شما مفید بوده و می‌خواهید از توسعه آن حمایت کنید، می‌توانید در یکی از شبکه های کریپتو زیر کمک مالی کنید:

- TRON network (TRC20): `TGftLESDAeRncE7yMAHrTUCsixuUwPc6qp`
- ETH, BNB, MATIC network (ERC20, BEP20): `0x413eb47C430a3eb0E4262f267C1AE020E0C7F84D`
- TON network: `UQDNpA3SlFMorlrCJJcqQjix93ijJfhAwIxnbTwZTLiHZ0Xa`


از حمایت شما متشکرم!


# لایسنس

توسعه‌یافته در [ناشناس!] و منتشر شده تحت لایسنس [AGPL-3.0](./LICENSE).


# مشارکت در توسعه
این ❤️‍🔥 تقدیم به همه‌ی کسانی که در توسعه رِبِکا مشارکت می‌کنند! اگر می‌خواهید مشارکت داشته باشید، لطفاً [دستورالعمل‌های مشارکت](CONTRIBUTING.md) را بررسی کنید و در صورت تمایل Pull Request ارسال کنید یا یک Issue باز کنید.

لطفاً با بررسی [لیست کارها](https://github.com/rebeccapanel/Rebecca/issues) به ما در بهبود رِبِکا کمک کنید. کمک‌های شما با آغوش باز پذیرفته می‌شود.

<p align="center">
با تشکر از همه همکارانی که به بهبود رِبِکا کمک کردند:
</p>
<p align="center">
<a href="https://github.com/rebeccapanel/Rebecca/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=rebeccapanel/Rebecca" />
</a>
</p>
<p align="center">
  ساخته شده با <a rel="noopener noreferrer" target="_blank" href="https://contrib.rocks">contrib.rocks</a>
</p>
