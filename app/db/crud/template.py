"""
Functions for managing proxy hosts, users, user templates, nodes, and administrative tasks.
"""

import logging

# MasterSettingsService not available in current project structure
MASTER_NODE_NAME = "Master"

_USER_STATUS_ENUM_ENSURED = False

_logger = logging.getLogger(__name__)
_RECORD_CHANGED_ERRNO = 1020
ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY = "admin_data_limit_exhausted"

# ============================================================================
