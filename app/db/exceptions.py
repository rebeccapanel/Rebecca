class UsersLimitReachedError(Exception):
    """Raised when an admin exceeds their active user quota or tries to set an invalid limit."""

    def __init__(self, limit: int | None = None, current_active: int | None = None):
        self.limit = limit
        self.current_active = current_active
        if limit is not None and current_active is not None:
            message = f"Cannot set users limit below active users (active: {current_active}, limit: {limit})."
        elif limit is None:
            message = "Active user limit has been reached."
        else:
            message = f"Active user limit has been reached (limit: {limit})."
        super().__init__(message)
