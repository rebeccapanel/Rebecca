# Rebecca Installer Scripts

Installer, lifecycle, and migration scripts for Rebecca and Rebecca Node.

## Install Rebecca

```bash
curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/master/scripts/rebecca/rebecca-binary.sh | sudo bash -s -- install
```

Other options:

```bash
curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/master/scripts/rebecca/rebecca-binary.sh | sudo bash -s -- install --dev
curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/master/scripts/rebecca/rebecca-binary.sh | sudo bash -s -- install --version v0.5.2
curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/master/scripts/rebecca/rebecca-binary.sh | sudo bash -s -- install --database mysql
```

`--database` accepts `sqlite`, `mysql` or `mariadb`. Without it, the installer asks.

Always pipe the download into `sudo bash -s --` as shown. Running the installer as `sudo bash -c "$(curl ...)"` can exceed Linux's argument limit.

Update to the dev channel or a specific release, and update Xray-core:

```bash
sudo rebecca update --dev
sudo rebecca update --version v0.5.2
sudo rebecca core-update
```

## Install Rebecca Node

```bash
curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/master/scripts/rebecca/rebecca-node-binary.sh | sudo bash -s -- install
curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/master/scripts/rebecca/rebecca-node-binary.sh | sudo bash -s -- install --name rebecca-node2
```

Install only the node CLI:

```bash
curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/master/scripts/rebecca/rebecca-node-binary.sh | sudo bash -s -- install-script
```

## Migration Helpers

Panel migration:

```bash
curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/master/scripts/rebecca/migrate_marzban_to_rebecca.sh | sudo bash -s --
```

Node migration:

```bash
curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/master/scripts/rebecca/migrate_marzban_node_to_rebecca.sh | sudo bash -s --
```

Back up the databases and `.env` files before running a migration script.
