<p align="center">
  <a href="https://github.com/rebeccapanel/Rebecca" target="_blank" rel="noopener noreferrer">
    <img width="160" height="160" src="./dashboard/src/assets/logo.svg" alt="Rebecca logo">
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
	<a href="./README.md">
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

<p align="center">
  <a href="https://github.com/rebeccapanel/Rebecca" target="_blank" rel="noopener noreferrer" >
    <img src="https://github.com/rebeccapanel/Rebecca-docs/raw/master/screenshots/preview.png" alt="Rebecca screenshots" width="600" height="auto">
  </a>
</p>


## فهرست مطالب
- [بررسی اجمالی](#بررسی-اجمالی)
  - [چرا رِبِکا؟](#چرا-رِبِکا)
    - [امکانات](#امکانات)
- [راهنمای نصب](#راهنمای-نصب)
- [تنظیمات](#تنظیمات)
- [داکیومنت](#داکیومنت)
- [استفاده از API](#استفاده-از-api)
- [پشتیبان گیری از رِبِکا](#پشتیبان-گیری-از-رِبِکا)
- [ربات تلگرام](#ربات-تلگرام)
- [رابط خط فرمان (CLI) رِبِکا](#رابط-خط-فرمان-cli-رِبِکا)
- [ارسال اعلان‌ها به آدرس وبهوک](#ارسال-اعلانها-به-آدرس-وبهوک)
- [کمک مالی](#کمک-مالی)
- [لایسنس](#لایسنس)
- [مشارکت در توسعه](#مشارکت-در-توسعه)


# بررسی اجمالی

رِبِکا یک نرم‌افزار (وب‌اپلیکیشن) مدیریت پروکسی است که امکان مدیریت چندصد حساب پروکسی را با سادگی و قدرت بالا فراهم می‌کند. رِبِکا از [Xray-core](https://github.com/XTLS/Xray-core) قدرت گرفته و با Python و React پیاده‌سازی شده است.

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

با دستور زیر رِبِکا را نصب کنید. نصاب از شما می‌پرسد نصب داکرایز می‌خواهید یا نصب باینری:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install
```

برای نصب خودکار، mode را صریح مشخص کنید:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install --mode docker
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install --mode binary
```

حالت داکرایز از SQLite، MySQL و MariaDB پشتیبانی می‌کند. با دستور زیر رِبِکا را با دیتابیس MySQL نصب کنید:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install --database mysql
```

با دستور زیر رِبِکا را با دیتابیس MariaDB نصب کنید:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install --database mariadb
```

حالت باینری به صورت سرویس native systemd نصب می‌شود و فعلا برای نصب سبک با SQLite منتشر می‌شود. بیلدهای ریلیز برای لینوکس روی معماری‌های `amd64`، `arm64`، `armv7`، `ppc64le` و `s390x` ساخته می‌شوند و نصاب asset مناسب را خودکار انتخاب می‌کند:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install --mode binary
```

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

اگر مشتاق هستید که رِبِکا را با پایتون و به صورت دستی اجرا کنید، مراحل زیر را مشاهده کنید
<details markdown="1">
<summary><h3>نصب به صورت دستی (پیچیده)</h3></summary>

لطفا xray را نصب کنید.
شما میتواند به کمک [Xray-install](https://github.com/XTLS/Xray-install) این کار را انجام دهید.

```bash
bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install
```

پروژه را clone کنید و dependency ها را نصب کنید. دقت کنید که نسخه پایتون شما Python>=3.8 باشد.

```bash
git clone https://github.com/rebeccapanel/Rebecca.git
cd Rebecca
wget -qO- https://bootstrap.pypa.io/get-pip.py | python3 -
python3 -m pip install -r requirements.txt
```

همچنین میتواند از , [Python Virtualenv](https://pypi.org/project/virtualenv/) هم استفاده کنید.

سپس کامند زیر را اجرا کنید تا دیتابیس تنظیم شود.

```bash
alembic upgrade head
```

اگر می‌خواهید از CLI استفاده کنید، می‌توانید فایل `rebecca-cli.py` موجود را به نام اجرایی جدید لینک کنید و تکمیل خودکار آن را نصب کنید:

```bash
sudo ln -s $(pwd)/rebecca-cli.py /usr/bin/rebecca-cli
sudo chmod +x /usr/bin/rebecca-cli
rebecca-cli completion install
```

حالا یک کپی از `.env.example` با نام `.env` بسازید و با یک ادیتور آن را باز کنید و تنظیمات دلخواه خود را انجام دهید. یه عنوان مثال نام کاربری و رمز عبور را می توانید در این فایل تغییر دهید.

```bash
cp .env.example .env
nano .env
```

> برای اطلاعات بیشتر بخش [تنظیمات](#تنظیمات) را مطالعه کنید.

در انتها، رِبِکا را به کمک دستور زیر اجرا کنید.

```bash
python3 main.py
```

اجرا با استفاده از systemctl در لینوکس
```
systemctl enable /var/lib/rebecca/rebecca.service
systemctl start rebecca
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

|                                                                                                                                                  توضیحات |                                                        متغیر                                                         |
|---------------------------------------------------------------------------------------------------------------------------------------------------------:| :------------------------------------------------------------------------------------------------------------------: |
|                                                                                                                                       نام کاربری مدیر کل |                                                    SUDO_USERNAME                                                     |
|                                                                                                                                         رمز عبور مدیر کل |                                                    SUDO_PASSWORD                                                     |
|                                           آدرس دیتابیس ([بر اساس مستندات SQLAlchemy](https://docs.sqlalchemy.org/en/20/core/engines.html#database-urls)) |                                               SQLALCHEMY_DATABASE_URL                                                |
|                                                                                               آدرس هاستی که رِبِکا روی آن اجرا میشود (پیشفرض: `0.0.0.0`) |                                                     UVICORN_HOST                                                     |
|                                                                                                       پورتی که رِبِکا روی آن اجرا میشود (پیشفرض: `8000`) |                                                     UVICORN_PORT                                                     |
|                                                                                                                اجرای رِبِکا بر روی یک Unix domain socket |                                                     UVICORN_UDS                                                      |
|                                                                                                               آدرس گواهی SSL به جهت ایمن کردن پنل رِبِکا |                                                 UVICORN_SSL_CERTFILE                                                 |
|                                                                                                                                      آدرس کلید گواهی SSL |                                                 UVICORN_SSL_KEYFILE                                                  |
|                                                          نوع گواهینامه مرجع SSL. از «خصوصی» برای آزمایش CA با امضای خود استفاده کنید (پیش‌فرض: `public`) |                                                 UVICORN_SSL_CA_TYPE                                                  |
|                                                                                                         مسیر باینری xray (پیشفرض: `/usr/local/bin/xray`) |                                                 XRAY_EXECUTABLE_PATH                                                 |
|                                                                                                    مسیر asset های xray (پیشفرض: `/usr/local/share/xray`) |                                                   XRAY_ASSETS_PATH                                                   |
|                                  پیشوند (یا هاست) آدرس های اشتراکی (زمانی کاربرد دارد که نیاز دارید دامنه subscription link ها با دامنه پنل متفاوت باشد) |                                             XRAY_SUBSCRIPTION_URL_PREFIX                                             |
|                                                                                                         تگ inboundای که به عنوان fallback استفاده میشود. |                                              XRAY_FALLBACKS_INBOUND_TAG                                              |
|                                                                                 تگ های inbound ای که لازم نیست در کانفیگ های ساخته شده وجود داشته باشند. |                                              XRAY_EXCLUDE_INBOUND_TAGS                                               |
|                                                                                                                آدرس محل template های شخصی سازی شده کاربر |                                              CUSTOM_TEMPLATES_DIRECTORY                                              |
|                                                                            تمپلیت مورد استفاده برای تولید کانفیگ های Clash (پیشفرض: `clash/default.yml`) |                                             CLASH_SUBSCRIPTION_TEMPLATE                                              |
|                                                                                      تمپلیت صفحه اطلاعات اشتراک کاربر (پیشفرض `subscription/index.html`) |                                              SUBSCRIPTION_PAGE_TEMPLATE                                              |
|                                                                                                              تمپلیت صفحه اول (پیشفرض: `home/index.html`) |                                                  HOME_PAGE_TEMPLATE                                                  |
|                                                                                        توکن ربات تلگرام (دریافت از [@botfather](https://t.me/botfather)) |                                                  TELEGRAM_API_TOKEN                                                  |
|                                                                           آیدی عددی ادمین در تلگرام (دریافت از [@userinfobot](https://t.me/userinfobot)) |                                                  TELEGRAM_ADMIN_ID                                                   |
|                                                                                                                                اجرای ربات از طریق پروکسی |                                                  TELEGRAM_PROXY_URL                                                  |
|                                                             مدت زمان انقضا توکن دسترسی به پنل رِبِکا, `0` به معنای بدون تاریخ انقضا است (پیشفرض: `1440`) |                                           JWT_ACCESS_TOKEN_EXPIRE_MINUTES                                            |
|                                                                                        فعال سازی داکیومنتیشن به آدرس `/docs` و `/redoc`(پیشفرض: `False`) |                                                         DOCS                                                         |
|                                                                                                      فعالسازی حالت توسعه (development) (پیشفرض: `False`) |                                                        DEBUG                                                         |
|                                  آدرس webhook که تغییرات حالت یک کاربر به آن ارسال می‌شوند. اگر این متغیر مقدار داشته باشد، ارسال پیام‌ها انجام می‌شوند. |                                                    WEBHOOK_ADDRESS                                                   |
|                                                                           متغیری که به عنوان `x-webhook-secret` در header ارسال می‌شود. (پیشفرض: `None`) |                                                    WEBHOOK_SECRET                                                    |
|                                                              تعداد دفعاتی که برای ارسال یک پیام، در صورت تشخیص خطا در ارسال تلاش دوباره شود (پیشفرض `3`) |                                          NUMBER_OF_RECURRENT_NOTIFICATIONS                                           |
|                                                                    مدت زمان بین هر ارسال دوباره پیام در صورت تشخیص خطا در ارسال به ثانیه (پیشفرض: `180`) |                                           RECURRENT_NOTIFICATIONS_TIMEOUT                                            |
|                                                                     هنگام رسیدن مصرف کاربر به چه درصدی پیام اخطار به آدرس وبهوک ارسال شود (پیشفرض: `80`) |                                             NOTIFY_REACHED_USAGE_PERCENT                                             |
|                                                                           چند روز مانده به انتهای سرویس پیام اخطار به آدرس وبهوک ارسال شود (پیشفرض: `3`) |                                                   NOTIFY_DAYS_LEFT                                                   |
 حذف خودکار کاربران منقضی شده (و بطور اختیاری محدود شده) پس از گذشت این تعداد روز (مقادیر منفی این قابلیت را به طور پیشفرض غیرفعال می کنند. پیشفرض: `-1`) |                                                   USERS_AUTODELETE_DAYS                                                   |
                                                                                                 تعیین اینکه کاربران محدودشده شامل حذف خودکار بشوند یا نه |                                                   USER_AUTODELETE_INCLUDE_LIMITED_ACCOUNTS                                 |
|                                                           فعال کردن کانفیگ سفارشی JSON برای همه برنامه‌هایی که از آن پشتیبانی می‌کنند (پیش‌فرض: `False`) | USE_CUSTOM_JSON_DEFAULT |
|                                                                                فعال کردن کانفیگ سفارشی JSON فقط برای برنامه‌ی V2rayNG (پیش‌فرض: `False`) | USE_CUSTOM_JSON_FOR_V2RAYNG |
|                                                                              فعال کردن کانفیگ سفارشی JSON فقط برای برنامه‌ی Streisand (پیش‌فرض: `False`) | USE_CUSTOM_JSON_FOR_STREISAND |
|                                                                                 فعال کردن کانفیگ سفارشی JSON فقط برای برنامه‌ی V2rayN (پیش‌فرض: `False`) | USE_CUSTOM_JSON_FOR_V2RAYN |


# داکیومنت
مستندات رِبِکا در حال تکمیل است. از مشارکت شما برای بهبود مستندات استقبال می‌کنیم. لطفاً در همین مخزن Issue یا Pull Request ثبت کنید.

# استفاده از API
رِبِکا به توسعه‌دهندگان API به صورت REST ارائه می‌دهد. برای مشاهده مستندات API در قالب Swagger UI یا ReDoc، متغیر `DOCS=True` را در تنظیمات ست کنید و در مرورگر به مسیرهای `/docs` و `/redoc` بروید.


# پشتیبان‌گیری از رِبِکا
بهتر است همیشه از فایل‌های رِبِکا نسخه پشتیبان تهیه کنید تا در صورت خرابی سیستم یا حذف تصادفی، اطلاعات از دست نروند. مراحل تهیه نسخه پشتیبان به شرح زیر است:

1. به‌طور پیش‌فرض، تمام فایل‌های مهم رِبِکا در `/var/lib/rebecca` ذخیره می‌شوند (در نسخه داکر). کل پوشه `/var/lib/rebecca` را به مکان پشتیبان مورد نظر خود، مانند هارد دیسک خارجی یا فضای ابری کپی کنید.
2. علاوه بر این، مطمئن شوید از فایل env خود که حاوی متغیرهای تنظیمات شماست و همچنین فایل پیکربندی Xray نسخه پشتیبان تهیه کنید.

سرویس پشتیبان‌گیری رِبِکا به‌طور کارآمد تمام فایل‌های ضروری را فشرده کرده و آن‌ها را به ربات تلگرام مشخص‌شده شما ارسال می‌کند. این سرویس از پایگاه‌های داده SQLite، MySQL و MariaDB پشتیبانی می‌کند. یکی از ویژگی‌های اصلی آن، خودکار بودن است که به شما اجازه می‌دهد پشتیبان‌گیری‌ها را به‌صورت زمان‌بندی‌شده انجام دهید. محدودیتی بابت اندازه فایل وجود ندارد؛ در صورت بزرگ بودن، فایل‌ها به چند بخش تقسیم و ارسال می‌شوند. همچنین می‌توانید هر زمان پشتیبان‌گیری فوری انجام دهید.

نصب آخرین نسخه اسکریپت رِبِکا:
```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install-script
```

راه‌اندازی سرویس پشتیبان‌گیری:
```bash
rebecca backup-service
```

پشتیبان‌گیری فوری:
```bash
rebecca backup
```

با انجام این مراحل، می توانید اطمینان حاصل کنید که از تمام فایل ها و داده های رِبِکا خود یک نسخه پشتیبان تهیه کرده اید. به خاطر داشته باشید که نسخه های پشتیبان خود را به طور مرتب به روز کنید تا آنها را به روز نگه دارید.


# ربات تلگرام
رِبِکا دارای یک ربات تلگرام داخلی است که می‌تواند مدیریت سرور، ایجاد و حذف کاربر و ارسال اعلان‌ها را انجام دهد. این ربات را می‌توان با چند مرحله ساده فعال کرد.

برای فعال کردن ربات تلگرام:

1. در تنظیمات، متغیر`TELEGRAM_API_TOKEN` را به API TOKEN ربات تلگرام خود تنظیم کنید.
2. همینطور، متغیر`TELEGRAM_ADMIN_ID` را به شناسه عددی حساب تلگرام خود تنظیم کنید. شما می‌توانید شناسه خود را از [@userinfobot](https://t.me/userinfobot) دریافت کنید.


# رابط خط فرمان (CLI)
رِبِکا دارای یک رابط خط فرمان (Command Line Interface / CLI) داخلی است که به مدیران اجازه می‌دهد با سیستم ارتباط مستقیم داشته باشند.

اگر از Docker برای رِبِکا استفاده می کنید، بهتر است از دستور های `docker exec` یا `docker-compose exec` استفاده کنید تا به پوسته (shell) تعاملی کانتینر رِبِکا دسترسی پیدا کنید.

برای مثال، به پوشه `docker-compose.yml` رِبِکا بروید و دستور زیر را اجرا کنید:

```bash
$ sudo docker-compose exec -it rebecca bash
```

رابط خط فرمان (CLI) رِبِکا از طریق دستور `rebecca-cli` در دسترس خواهد بود.

برای کسب اطلاعات بیشتر می توانید [مستندات CLI رِبِکا](./cli/README.md) را مطالعه کنید.


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

