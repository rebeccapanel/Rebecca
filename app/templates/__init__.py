import logging
from datetime import datetime, UTC
from functools import lru_cache
from typing import Optional, Union

import jinja2

from config import CUSTOM_TEMPLATES_DIRECTORY

from .filters import CUSTOM_FILTERS

logger = logging.getLogger("uvicorn.error")


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


def _render_with_legacy_placeholder_fix(
    env: jinja2.Environment,
    template: str,
    context: Union[dict, None],
) -> Optional[str]:
    """
    Backward-compatibility fix for older builder output that embedded
    JS placeholders as {{...}} and broke Jinja parsing.
    """
    try:
        source, _, _ = env.loader.get_source(env, template)
    except Exception:
        return None

    patched = source
    replacements = (
        ("{{\\\\s*", "[[\\\\s*"),
        ("\\\\s*}}", "\\\\s*]]"),
        ("{{index}}", "[[index]]"),
        ("{{days}}", "[[days]]"),
        ("{{count}}", "[[count]]"),
    )
    for old, new in replacements:
        patched = patched.replace(old, new)

    if patched == source:
        return None

    try:
        return env.from_string(patched).render(context or {})
    except Exception:
        return None


def render_template(template: str, context: Union[dict, None] = None, *, custom_directory: Optional[str] = None) -> str:
    env = _get_env(custom_directory)
    try:
        return env.get_template(template).render(context or {})
    except jinja2.TemplateSyntaxError as exc:
        fallback_render = _render_with_legacy_placeholder_fix(env, template, context)
        if fallback_render is not None:
            logger.warning(
                "Recovered legacy placeholder syntax in template '%s' after Jinja syntax error: %s",
                template,
                exc,
            )
            return fallback_render
        raise
