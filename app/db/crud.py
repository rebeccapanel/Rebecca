"""
Backward compatibility wrapper for CRUD functions.

The real implementations now live in the app.db.crud package (directory).
This module simply re-exports everything from that package so existing
imports like ``from app.db import crud`` keep working.
"""

from importlib import import_module

_pkg = import_module("app.db.crud.__init__")
globals().update({k: v for k, v in _pkg.__dict__.items() if not k.startswith("_")})

__all__ = [k for k in globals().keys() if not k.startswith("_")]
