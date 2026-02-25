from datetime import datetime, UTC
from functools import lru_cache
from typing import Optional, Union

import jinja2

from config import CUSTOM_TEMPLATES_DIRECTORY

from .filters import CUSTOM_FILTERS


@lru_cache(maxsize=8)
def _get_env(custom_directory: Optional[str] = None) -> jinja2.Environment:
    template_directories = ["app/templates"]
    if custom_directory:
        template_directories.insert(0, custom_directory)
    elif CUSTOM_TEMPLATES_DIRECTORY:
        template_directories.insert(0, CUSTOM_TEMPLATES_DIRECTORY)

    env = jinja2.Environment(loader=jinja2.FileSystemLoader(template_directories))
    env.filters.update(CUSTOM_FILTERS)
    env.globals["now"] = lambda: datetime.now(UTC).replace(tzinfo=None)
    return env


def render_template(template: str, context: Union[dict, None] = None, *, custom_directory: Optional[str] = None) -> str:
    env = _get_env(custom_directory)
    return env.get_template(template).render(context or {})
