<p align="center">
  <a href="https://github.com/rebeccapanel/Rebecca" target="_blank" rel="noopener noreferrer">
    <img width="160" height="160" src="./dashboard/src/assets/logo.svg" alt="Rebecca logo">
  </a>
</p>

<h1 align="center"/>Rebecca</h1>

<p align="center">
    Унифицированное решение с графическим интерфейсом, устойчивое к цензуре, на базе <a href="https://github.com/XTLS/Xray-core">Xray</a>
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

## Оглавление

- [Введение](#введение)
  - [Почему Rebecca?](#почему-rebecca)
    - [Функции](#функции)
- [Руководство по установке](#руководство-по-установке)
- [Конфигурация](#конфигурация)
- [документация](#документация)
- [API](#api)
- [Backup](#backup)
- [Telegram Bot](#telegram-bot)
- [Rebecca CLI](#rebecca-cli)
- [Rebecca Node](#rebecca-node)
- [Webhook уведомления](#webhook-уведомления)
- [Поддержка](#поддержка)
- [Лицензия](#лицензия)
- [Участники](#участники)

# Введение

Rebecca — это инструмент управления прокси-серверами, который предоставляет простой и удобный пользовательский интерфейс для управления сотнями учетных записей прокси на базе [Xray-core](https://github.com/XTLS/Xray-core) и созданный с использованием Python и ReactJS.

## Почему Rebecca?

Rebecca удобен в использовании, многофункционален и надежен. Он позволяет создавать различные прокси для пользователей без сложной настройки. С помощью встроенного веб-интерфейса можно контролировать, изменять и ограничивать пользователей.

### Функции

- Готовый **Web UI**
- **REST API** бэкэнд
- Поддержка [**множества узлов**](#rebecca-node) (для распределения инфраструктуры и масштабируемости)
- Поддержка протоколов **Vmess**, **VLESS**, **Trojan** и **Shadowsocks**
- Возможность активации **нескольких протоколов** для каждого пользователя
- **Несколько пользователей** на одном inbound
- **Несколько inbound** на **одном порту** (поддержка fallbacks)
- Ограничения на основе **количества трафика** и **срока действия**
- Ограничение трафика по **периодам** (например выдавать трафик на день, неделю и т. д.)
- Поддержка **ссылок-подписок** совместимых с **V2ray** _(такие как V2RayNG, SingBox, Nekoray, и др.)_, **Clash** и **ClashMeta**
- Автоматическая генерация **Ссылок** и **QRcode** 
- Мониторинг ресурсов сервера и **использования трафика**
- Настраиваемые конфигурации xray
- Поддержка **TLS** и **REALITY** 
- Встроенный **Telegram Bot**
- Встроенный **Command Line Interface (CLI)**
- **Несколько языков**
- Поддержка **Нескольких администраторов** (WIP)

# Руководство по установке

Установка Rebecca с базой данных SQLite (по умолчанию):

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install
```

Установка Rebecca с базой данных MySQL:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install --database mysql
```

Установка Rebecca с базой данных MariaDB:
```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install --database mariadb
```

Когда установка будет завершена:
- Вы увидите логи, которые можно остановить, нажав `Ctrl+C` или закрыв терминал.
- Файлы Rebecca будут размещены по адресу `/opt/rebecca`.
- Файл конфигурации будет размещен по адресу `/opt/rebecca/.env` (см. [Конфигурация](#конфигурация)).
- Файлы с данными будут размещены по адресу `/var/lib/rebecca`.
- По соображениям безопасности, панель управления Rebecca недоступна через IP-адрес. Поэтому вам необходимо [получить SSL-сертификат](https://rebeccapanel.github.io/rebecca/ru/examples/issue-ssl-certificate) и получить доступ к панели управления Rebecca, открыв веб-браузер и перейдя по адресу `https://YOUR_DOMAIN:8000/dashboard/` (замените YOUR_DOMAIN на ваш фактический домен).
- Вы также можете использовать перенаправление портов SSH для локального доступа к панели управления Rebecca без домена. Замените `user@serverip` на ваше фактическое имя пользователя SSH и IP-адрес сервера и выполните следующую команду:

```bash
ssh -L 8000:localhost:8000 user@serverip
```

Наконец, введите следующую ссылку в ваш браузер, чтобы получить доступ к панели управления Rebecca:

http://localhost:8000/dashboard/

Вы потеряете доступ к панели управления, как только закроете терминал SSH. Поэтому этот метод рекомендуется использовать только для тестирования.

Далее, Вам нужно создать главного администратора для входа в панель управления Rebecca, выполнив следующую команду: 

```bash
rebecca cli admin create --sudo
```

Готово! Теперь Вы можете войти, используя данные своей учетной записи.

Для того, чтобы увидеть справочное сообщение от скрипта Rebecca, выполните команду:

```bash
rebecca --help
```

Если Вы хотите запустить проект, используя его исходный код, обратитесь к разделу ниже
<details markdown="1">
<summary><h3>Ручная установка</h3></summary>

Установите xray на Ваш сервер.

Вы можете сделать это, используя [Xray-install](https://github.com/XTLS/Xray-install):

```bash
bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install
```

Клонируйте этот проект и установите зависимости (Вам нужен Python >= 3.8):

```bash
git clone https://github.com/rebeccapanel/Rebecca.git
cd Rebecca
wget -qO- https://bootstrap.pypa.io/get-pip.py | python3 -
python3 -m pip install -r requirements.txt
```

В качестве альтернативы для создания виртуальной среды можно использовать [Python Virtualenv](https://pypi.org/project/virtualenv/).

Затем выполните следующую команду для запуска скрипта миграции базы данных:

```bash
alembic upgrade head
```

Если Вы хотите использовать `rebecca-cli`, необходимо связать его с файлом в `$PATH`, сделать его исполняемым и установить:

```bash
sudo ln -s $(pwd)/rebecca-cli.py /usr/bin/rebecca-cli
sudo chmod +x /usr/bin/rebecca-cli
rebecca-cli completion install
```

Теперь настало время настройки.

Создайте копию файла `.env.example`, посмотрите его и отредактируйте с помощью текстового редактора,например `nano`.

Возможно, вам захочется изменить учетные данные администратора.

```bash
cp .env.example .env
nano .env
```

> Проверьте раздел [Конфигурации](#конфигурация) для получения большей информации.

В завершение запустите приложение с помощью следующей команды:

```bash
python3 main.py
```

Для запуска с помощью linux systemctl (скопируйте файл rebecca.service в `/var/lib/rebecca/rebecca.service`):

```
systemctl enable /var/lib/rebecca/rebecca.service
systemctl start rebecca
```

Для использования с nginx:

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

    # xray-core ws-path: /
    # client ws-path: /rebecca/me/2087
    #
    # All traffic is proxed through port 443, and send to the xray port(2087, 2088 etc.).
    # The '/rebecca' in location regex path can changed any characters by yourself.
    #
    # /${path}/${username}/${xray-port}
    location ~* /rebecca/.+/(.+)$ {
        proxy_redirect off;
        proxy_pass http://127.0.0.1:$1/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

или:

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

По умолчанию приложение будет запускаться на `http://localhost:8000/dashboard`. Вы можете настроить его, изменив переменные окружения `UVICORN_HOST` и `UVICORN_PORT`.
</details>

# Конфигурация

> Ниже приведены настройки, которые можно задать с помощью переменных окружения поместив их в файл `.env`.

| Перменная                                | Описание                                                                                                                       |
| ---------------------------------------- |--------------------------------------------------------------------------------------------------------------------------------|
| SUDO_USERNAME                            | Имя пользователя главного администратора                                                                                       |
| SUDO_PASSWORD                            | Пароль главного администратора                                                                                                 |
| SQLALCHEMY_DATABASE_URL                  | Путь к файлу БД ([SQLAlchemy's docs](https://docs.sqlalchemy.org/en/20/core/engines.html#database-urls))                       |
| UVICORN_HOST                             | Привязка приложения к хосту (по умолчанию: `0.0.0.0`)                                                                          |
| UVICORN_PORT                             | Привязка приложения к порту (по умолчанию: `8000`)                                                                             |
| UVICORN_UDS                              | Привязка приложения к UNIX domain socket                                                                                       |
| UVICORN_SSL_CERTFILE                     | Адрес файла сертификата SSL                                                                                                    |
| UVICORN_SSL_KEYFILE                      | Адрес файла ключа SSL                                                                                                          |
| UVICORN_SSL_CA_TYPE                      | Тип центра сертификации ключа SSL. Используйте `private` для тестирования самоподписанных CA (по умолчанию: `public`)          |
| XRAY_EXECUTABLE_PATH                     | Путь к бинарникам Xray  (по умолчанию: `/usr/local/bin/xray`)                                                                  |
| XRAY_ASSETS_PATH                         | Путь к папке с рессурсными файлами для Xray (файлы geoip.dat и geosite.dat) (по умолчанию: `/usr/local/share/xray`)            |
| XRAY_SUBSCRIPTION_URL_PREFIX             | Префикс адреса подписки                                                                                                        |
| XRAY_FALLBACKS_INBOUND_TAG               | Если вы используете входящее соединение с несколькими резервными вариантами, укажите здесь его тег                             |
| XRAY_EXCLUDE_INBOUND_TAGS                | Теги входящих соединений, которые не требуют управления и не должны быть включены в список прокси                              |
| CUSTOM_TEMPLATES_DIRECTORY               | Путь к папке с пользовательскими шаблонами (по умолчанию: `app/templates`)                                                     |
| CLASH_SUBSCRIPTION_TEMPLATE              | Шаблон для создания конфигурации Clash (по умолчанию: `clash/default.yml`)                                                     |
| SUBSCRIPTION_PAGE_TEMPLATE               | Шаблон для страницы подписки (по умолчанию: `subscription/index.html`)                                                         |
| HOME_PAGE_TEMPLATE                       | Шаблон главной страницы (по умолчанию: `home/index.html`)                                                                      |
| TELEGRAM_API_TOKEN                       | Токен Telegram-бота  (полученный от [@botfather](https://t.me/botfather))                                                      |
| TELEGRAM_ADMIN_ID                        | Числовой идентификатор администратора в Telegram (полученный от [@userinfobot](https://t.me/userinfobot))                      |
| TELEGRAM_PROXY_URL                       | URL прокси для запуска Telegram-бота (если серверы Telegram заблокированы на вашем сервере).                                   |
| JWT_ACCESS_TOKEN_EXPIRE_MINUTES          | Время истечения срока действия доступного токена в минутах, `0` означает "без истечения срока действия" (по умолчанию: `1440`) |
| DOCS                                     | Активация документации API по адресам `/docs` и `/redoc`. (по умолчанию: `False`)                                              |
| DEBUG                                    | Активация режима разработки (development) (по умолчанию: `False`)                                                              |
| WEBHOOK_ADDRESS                          | Адрес Webhook для отправки уведомлений. Уведомления Webhook будут отправляться, если это значение было установлено             |
| WEBHOOK_SECRET                           | Webhook secret будет передаваться с каждым запросом в виде `x-webhook-secret` в заголовке (по умолчанию: `None`)               |
| NUMBER_OF_RECURRENT_NOTIFICATIONS        | Сколько раз повторять попытку отправки уведомления при обнаружении ошибки  (по умолчанию: `3`)                                 |
| RECURRENT_NOTIFICATIONS_TIMEOUT          | Тайм-аут между каждым повторным запросом при обнаружении ошибки в секундах (по умолчанию: `180`)                               |
| NOTIFY_REACHED_USAGE_PERCENT             | При каком проценте использования отправлять предупреждение (по умолчанию: `80`)                                                |
| NOTIFY_DAYS_LEFT                         | Когда отправлять предупреждение об истечении срока действия (по умолчанию: `3`)                                                |
| USERS_AUTODELETE_DAYS                    | Delete expired (and optionally limited users) after this many days (Negative values disable this feature, default: `-1`)       |
| USER_AUTODELETE_INCLUDE_LIMITED_ACCOUNTS | Weather to include limited accounts in the auto-delete feature (default: `False`)                                              |
| USE_CUSTOM_JSON_DEFAULT                  | Enable custom JSON config for ALL supported clients (default: `False`)                                                         |
| USE_CUSTOM_JSON_FOR_V2RAYNG              | Enable custom JSON config only for V2rayNG (default: `False`)                                                                  |
| USE_CUSTOM_JSON_FOR_STREISAND            | Enable custom JSON config only for Streisand (default: `False`)                                                                |
| USE_CUSTOM_JSON_FOR_V2RAYN               | Enable custom JSON config only for V2rayN (default: `False`)                                                                   |

# документация

[Документация Rebecca](https://rebeccapanel.github.io/rebecca/ru/) предоставляет все необходимые руководства для начала работы и доступна на трех языках: фарси, английском и русском. Для полного охвата всех аспектов проекта требуется значительное количество усилий. Мы приветствуем и ценим ваш вклад в улучшение документации. Вы можете внести свой вклад в этот [репозиторий на GitHub](https://github.com/rebeccapanel/Rebeccapanel.github.io).

# API

Rebecca предоставляет REST API, позволяющий разработчикам программно взаимодействовать с сервисами Rebecca. Для просмотра документации по API в Swagger UI или ReDoc установите  переменную `DOCS=True` и перейдите по ссылкам `/docs` и `/redoc`.

# Backup

Всегда полезно регулярно создавать резервные копии файлов Rebecca, чтобы предотвратить потерю данных в случае системных сбоев или случайного удаления. Ниже приведены шаги для создания резервной копии Rebecca:

1. По умолчанию все важные файлы Rebecca сохраняются в папке `/var/lib/rebecca` (в версиях Docker). Скопируйте весь каталог `/var/lib/rebecca` в выбранное вами место резервного копирования, например на внешний жесткий диск или в облачное хранилище.
2. Кроме того, не забудьте сделать резервную копию файла env, содержащего переменные конфигурации, а также файла конфигурации Xray. При стандартной установке env и другие конфигурации находятся в каталоге `/opt/rebecca/`.

Выполнив эти действия, вы сможете обеспечить резервное копирование всех файлов и данных Rebecca, а также переменных конфигурации и конфигурации Xray на случай, если в будущем потребуется их восстановить. Не забывайте регулярно обновлять резервные копии, чтобы поддерживать их в актуальном состоянии.

# Telegram Bot

Rebecca поставляется с встроенным ботом Telegram, который может управлять сервером, создавать и удалять пользователей, а также отправлять уведомления. Этот бот можно легко включить, выполнив несколько простых шагов, и он предоставляет удобный способ взаимодействия с Rebecca без необходимости каждый раз заходить на сервер.

Чтобы включить Telegram-бота, выполните следующие действия:

1. установите `TELEGRAM_API_TOKEN` в качестве API-токена вашего бота.
2. установите `TELEGRAM_ADMIN_ID` в качестве цифрового ID вашего Telegram-аккаунта, который вы можете получить от [@userinfobot](https://t.me/userinfobot)

Сервис резервного копирования Rebecca эффективно архивирует все необходимые файлы и отправляет их вашему указанному Telegram-боту. Он поддерживает базы данных SQLite, MySQL и MariaDB. Одной из ключевых особенностей является автоматизация, позволяющая настроить расписание резервного копирования, например, каждый час. При этом ограничений на размер файлов для загрузки в Telegram через бота нет: если файл превышает лимит, он будет автоматически разделен и отправлен частями. Также можно запустить резервное копирование вручную в любой момент.

Установка последней версии Rebecca:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install-script
```

Настройка сервиса резервного копирования:

```bash
rebecca backup-service
```

Мгновенное резервное копирование:

```bash
rebecca backup
```

# Rebecca CLI

Rebecca поставляется с встроенным CLI под названием `rebecca-cli`, который позволяет администраторам напрямую взаимодействовать с ним.

Если вы установили Rebecca с помощью скрипта установки, то доступ к командам cli можно получить, выполнив команду:

```bash
rebecca cli [OPTIONS] COMMAND [ARGS]...
```

Для получения дополнительной информации можно ознакомиться с [документацией по Rebecca CLI](./cli/README.md).

# Rebecca Node

Проект Rebecca представляет [Rebecca-node](https://github.com/rebeccapanel/Rebecca-node), который помогает Вам в распределении инфраструктуры. С помощью Rebecca-node можно распределить инфраструктуру по нескольким узлам, получив такие преимущества, как высокая доступность, масштабируемость и гибкость. Rebecca-node позволяет пользователям подключаться к различным серверам, предоставляя им гибкость в выборе, а не ограничиваться только одним сервером.
Более подробная информация и инструкции по установке приведены в [официальной документации Rebecca-node](https://github.com/rebeccapanel/Rebecca-node).


# Webhook уведомления

Вы можете задать адрес webhook, и Rebecca будет отправлять уведомления на этот адрес.

Запросы будут отправляться в виде POST-запроса на адрес, указанный в `WEBHOOK_ADDRESS`, с `WEBHOOK_SECRET` в качестве `x-webhook-secret` в заголовках.

Пример запроса, отправленного Rebecca:

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

Различные типы действий: `user_created`, `user_updated`, `user_deleted`, `user_limited`, `user_expired`, `user_disabled`, `user_enabled`

# Поддержка

Если вы нашли Rebecca полезным и хотели бы поддержать его развитие, вы можете сделать пожертвование в одной из следующих криптовалютных сетей:

- TRON network (TRC20): `TGftLESDAeRncE7yMAHrTUCsixuUwPc6qp`
- ETH, BNB, MATIC network (ERC20, BEP20): `0x413eb47C430a3eb0E4262f267C1AE020E0C7F84D`
- TON network: `UQDNpA3SlFMorlrCJJcqQjix93ijJfhAwIxnbTwZTLiHZ0Xa`

Спасибо за поддержку!

# Лицензия

Сделано в [Unknown!] и опубликовано под [AGPL-3.0](./LICENSE).

# Участники

Мы ❤️‍🔥 участников проекта! Если вы хотите внести свой вклад, пожалуйста, ознакомьтесь с нашим [Contributing Guidelines](CONTRIBUTING.md) и не стесняйтесь отправлять запросы на исправление ошибок или сообщить о проблеме. Мы также приглашаем вас присоединиться к нашей группе [Telegram](https://t.me/rebeccapanel_rebecca) для получения поддержки.

Проверьте [open issues](https://github.com/rebeccapanel/Rebecca/issues), чтобы помочь развитию этого проекта.

<p align="center">
Спасибо всем участникам, благодаря которым Rebecca становится лучше:
</p>
<p align="center">
<a href="https://github.com/rebeccapanel/Rebecca/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=rebeccapanel/Rebecca" />
</a>
</p>
<p align="center">
  Made with <a rel="noopener noreferrer" target="_blank" href="https://contrib.rocks">contrib.rocks</a>
</p>
