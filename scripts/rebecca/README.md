# Rebecca Installer Scripts

Installer, lifecycle, and migration scripts for Rebecca and Rebecca Node.

## Install Rebecca

Docker and binary installers are intentionally separate.

Docker install:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install
```

Binary install:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca-binary.sh)" @ install
```

Binary mode installs the published Linux release asset for the current machine.

Install the dev channel explicitly:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install --dev
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca-binary.sh)" @ install --dev
```

Dockerized mode supports SQLite, MySQL, and MariaDB:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install --database mysql
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install --database mariadb
```

Install a specific release:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca.sh)" @ install --version v0.5.2
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca-binary.sh)" @ install --version v0.5.2
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

Docker node install:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca-node.sh)" @ install
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca-node.sh)" @ install --name rebecca-node2
```

Binary node install:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca-node-binary.sh)" @ install
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca-node-binary.sh)" @ install --name rebecca-node2
```

Install only the node CLI:

```bash
sudo bash -c "$(curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/dev/scripts/rebecca/rebecca-node.sh)" @ install-script
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
