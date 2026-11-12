<p align="center">
  <a href="https://github.com/rebeccapanel/Rebecca" target="_blank" rel="noopener noreferrer">
    <img width="160" height="160" src="./dashboard/src/assets/logo.svg" alt="Rebecca logo">
  </a>
</p>

<h1 align="center">Rebecca</h1>

<p align="center">
  Unified GUI Censorship Resistant Solution Powered by <a href="https://github.com/XTLS/Xray-core">Xray</a>
</p>

<p align="center">
  <a href="https://github.com/rebeccapanel/Rebecca/actions/workflows/build.yml"><img src="https://img.shields.io/github/actions/workflow/status/rebeccapanel/Rebecca/build.yml?style=flat-square" alt="Build status"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/rebeccapanel/Rebecca?style=flat-square" alt="License"></a>
  <a href="https://t.me/rebeccapanel_rebecca"><img src="https://img.shields.io/badge/telegram-channel-blue?style=flat-square&logo=telegram" alt="Telegram channel"></a>
</p>

<p align="center">
  <a href="./README.md">English</a> /
  <a href="./docs/README-fa.md">فارسی</a> /
  <a href="./docs/README-zh-cn.md">简体中文</a> /
  <a href="./docs/README-ru.md">Русский</a>
</p>

## Overview

Rebecca is a proxy management panel for hundreds of accounts. It lets you create different proxies for your users without complicated configuration, and monitor, modify and limit them from a built-in web dashboard. It is powered by [Xray-core](https://github.com/XTLS/Xray-core), with a Go backend and a React dashboard.

- Built-in **web dashboard** and a full **REST API**
- **Multiple nodes** to spread infrastructure and scale out
- **VMess**, **VLESS**, **Trojan** and **Shadowsocks**, with **multi-protocol** users, **multi-user** and **multi-inbound** on a single port (fallbacks)
- **Traffic** and **expiry** limits, including **periodic** limits (daily, weekly, ...)
- **Subscription links** for V2Ray clients, **Clash** and **Clash Meta**, plus share links and QR codes
- **TLS** and **REALITY**
- Traffic statistics and system monitoring
- Custom Xray configuration
- Command-line interface, **multi-language** dashboard and **multi-admin** support (WIP)

## Installation

Install the panel with the binary installer. It creates a systemd service and downloads the release for your server's architecture.

```bash
curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/master/scripts/rebecca/rebecca-binary.sh | sudo bash -s -- install
```

For the dev channel:

```bash
curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca-binary.sh | sudo bash -s -- install --dev
```

Always pipe the script into `sudo bash -s --` as shown. Running it as `sudo bash -c "$(curl ...)"` can fail with `Argument list too long`.

The installer asks which database to use. To skip the prompt, pass `--database sqlite`, `--database mysql` or `--database mariadb`. MySQL and MariaDB are installed on the host.

Install a node on each node server with the [node installer](https://github.com/rebeccapanel/rebecca-node).

### After installing

- The application is in `/opt/rebecca`, its settings are in `/opt/rebecca/.env`, and its data is in `/var/lib/rebecca`.
- Create a full-access admin to sign in to the dashboard:

  ```bash
  rebecca cli admin create --role full_access
  ```

  Full-access admins can only be created by another full-access admin or with the on-box CLI. To promote an existing admin, run `rebecca cli admin change-role --username NAME --role full_access`.
- The dashboard is not reachable by IP address. Point a domain at the server and get an SSL certificate, then open `https://YOUR_DOMAIN:8000/dashboard/`.
- Without a domain, open an SSH tunnel and use `http://localhost:8000/dashboard/` while it is open. Use this for testing only:

  ```bash
  ssh -L 8000:localhost:8000 user@server
  ```

- Run `rebecca --help` to see all commands.

<details>
<summary>Manual install from source (advanced)</summary>

1. Install Xray-core with [Xray-install](https://github.com/XTLS/Xray-install).

2. Clone the project and build the dashboard and the Go binaries:

   ```bash
   git clone https://github.com/rebeccapanel/Rebecca.git
   cd Rebecca/dashboard
   npm ci
   VITE_BASE_API=/api/ npm run build -- --outDir=build --assetsDir=statics
   cp ./build/index.html ./build/404.html
   cd ..
   bash scripts/build_binary.sh
   ```

3. Create the settings file and edit it: `cp .env.example .env`.

4. Run the database migrations. Downgrades are not supported, so check `./dist/rebecca-cli migrate status` before upgrading an existing database:

   ```bash
   ./dist/rebecca-cli migrate up
   ```

5. Run the server. For a systemd service, use this unit and adjust the paths to where you cloned the project:

   ```ini
   [Unit]
   Description=Rebecca
   After=network.target

   [Service]
   WorkingDirectory=/opt/rebecca
   EnvironmentFile=/opt/rebecca/.env
   ExecStart=/opt/rebecca/dist/rebecca-server
   Restart=on-failure
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

   Then run `sudo systemctl daemon-reload && sudo systemctl enable --now rebecca`.

</details>

## Configuration

Settings come from `/opt/rebecca/.env` or from environment variables. [`.env.example`](.env.example) lists every variable with its default. Most installs only change these:

| Variable | Description |
| --- | --- |
| `SQLALCHEMY_DATABASE_URL` | Database URL. Required. The name is kept for compatibility. |
| `UVICORN_HOST` | Address the panel listens on. Default `0.0.0.0`. |
| `UVICORN_PORT` | Port the panel listens on. Default `8000`. |
| `UVICORN_SSL_CERTFILE`, `UVICORN_SSL_KEYFILE` | TLS certificate and key for the panel. |
| `USERS_AUTODELETE_DAYS` | Delete expired users after this many days. Default `-1` disables it. |
| `USER_AUTODELETE_INCLUDE_LIMITED_ACCOUNTS` | Include limited accounts in auto-delete. |

## Donation

If Rebecca is useful to you, you can support its development:

- TRON (TRC20): `TGftLESDAeRncE7yMAHrTUCsixuUwPc6qp`
- ETH, BNB, MATIC (ERC20, BEP20): `0x413eb47C430a3eb0E4262f267C1AE020E0C7F84D`
- TON: `UQDNpA3SlFMorlrCJJcqQjix93ijJfhAwIxnbTwZTLiHZ0Xa`

## License

Released under the [AGPL-3.0](./LICENSE) license.

## Contributing

Pull requests and issues are welcome. Read the [contributing guide](docs/CONTRIBUTING.md) first, and check the [open issues](https://github.com/rebeccapanel/Rebecca/issues).
