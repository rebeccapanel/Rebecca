# Rebecca Installer Scripts

Installer and maintenance scripts for Rebecca, Rebecca Node, and migration helpers.

## Install Rebecca

Default installation asks for the installation mode, then asks whether you want the `latest` or `dev` channel:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install
```

Use an explicit mode for automated provisioning:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install --mode docker
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install --mode binary
```

Binary mode installs the published Linux release asset for the current machine. Release assets are built for `amd64`, `arm64`, `armv7`, `ppc64le`, and `s390x`.

Install the dev channel explicitly:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install --mode docker --dev
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install --mode binary --dev
```

Dockerized mode supports SQLite, MySQL, and MariaDB:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install --database mysql
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install --database mariadb
```

Install a specific release:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install --version v0.5.2
```

Update to the dev channel or a specific release:

```bash
sudo rebecca update --dev
sudo rebecca update --version v0.5.2
```

Update or change Xray-core:

```bash
sudo rebecca core-update
```

## Install Rebecca Node

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca-node.sh)" @ install
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca-node.sh)" @ install --name rebecca-node2
```

Install only the node CLI:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca-node.sh)" @ install-script
```

## Maintenance Service

Install only the Rebecca maintenance API:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install-service
```

Install only the Rebecca Node maintenance API:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca-node.sh)" @ install-service --name rebecca-node
```

## Migration Helpers

Panel migration:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/migrate_marzban_to_rebecca.sh)"
```

Node migration:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/migrate_marzban_node_to_rebecca.sh)"
```

Back up compose files and databases before running migration scripts.
