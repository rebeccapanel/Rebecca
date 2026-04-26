#!/usr/bin/env python3
from __future__ import annotations

import logging
import os
import runpy
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config


logger = logging.getLogger("rebecca.binary")


def resource_path(*parts: str) -> Path:
    bundle_root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    return bundle_root.joinpath(*parts)


def run_migrations() -> None:
    config_path = resource_path("alembic.ini")
    migrations_path = resource_path("app", "db", "migrations")
    if not config_path.exists() or not migrations_path.exists():
        logger.warning("Alembic files are not bundled; skipping migrations")
        return

    previous_skip_runtime_init = os.environ.get("REBECCA_SKIP_RUNTIME_INIT")
    os.environ["REBECCA_SKIP_RUNTIME_INIT"] = "1"
    try:
        alembic_config = Config(str(config_path))
        alembic_config.set_main_option("script_location", str(migrations_path))
        command.upgrade(alembic_config, "head")
    finally:
        if previous_skip_runtime_init is None:
            os.environ.pop("REBECCA_SKIP_RUNTIME_INIT", None)
        else:
            os.environ["REBECCA_SKIP_RUNTIME_INIT"] = previous_skip_runtime_init


def clear_migration_imports() -> None:
    for module_name in list(sys.modules):
        if module_name == "app" or module_name.startswith("app."):
            sys.modules.pop(module_name, None)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    run_migrations()
    clear_migration_imports()
    runpy.run_module("main", run_name="__main__")


if __name__ == "__main__":
    main()
