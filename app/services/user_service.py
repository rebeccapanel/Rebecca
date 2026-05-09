"""
User service layer.

Read-only user list/detail paths are delegated to the Go bridge. Mutating
operations still use the Python CRUD layer until their migration phase.
"""

from typing import List, Optional

from app.db import crud, Session
from app.db.models import User
from app.models.user import UserCreate, UserModify, UserResponse, UserStatus, UsersResponse


def get_users_list(
    db: Session,
    *,
    offset: Optional[int],
    limit: Optional[int],
    username: Optional[List[str]],
    search: Optional[str],
    status: Optional[UserStatus],
    sort,
    advanced_filters,
    service_id: Optional[int],
    dbadmin,
    owners: Optional[List[str]],
    users_limit: Optional[int],
    active_total: Optional[int],
    include_links: bool = False,
    request_origin: Optional[str] = None,
) -> UsersResponse:
    del db
    from app.services import go_user

    return go_user.get_users_list(
        offset=offset,
        limit=limit,
        username=username,
        search=search,
        status=status,
        sort=sort,
        advanced_filters=advanced_filters,
        service_id=service_id,
        dbadmin=dbadmin,
        owners=owners,
        users_limit=users_limit,
        active_total=active_total,
        include_links=include_links,
        request_origin=request_origin,
    )


def get_users_list_db_only(
    db: Session,
    *,
    offset: Optional[int],
    limit: Optional[int],
    username: Optional[List[str]],
    search: Optional[str],
    status: Optional[UserStatus],
    sort,
    advanced_filters,
    service_id: Optional[int],
    dbadmin,
    owners: Optional[List[str]],
    users_limit: Optional[int],
    active_total: Optional[int],
    include_links: bool = False,
    request_origin: Optional[str] = None,
) -> UsersResponse:
    """Compatibility wrapper for callers that still use the old function name."""
    from app.services import go_user

    return go_user.get_users_list(
        offset=offset,
        limit=limit,
        username=username,
        search=search,
        status=status,
        sort=sort,
        advanced_filters=advanced_filters,
        service_id=service_id,
        dbadmin=dbadmin,
        owners=owners,
        users_limit=users_limit,
        active_total=active_total,
        include_links=include_links,
        request_origin=request_origin,
    )


def get_user_detail(username: str, db: Session) -> Optional[UserResponse]:
    dbuser = crud.get_user(db, username=username)
    if not dbuser:
        return None
    return UserResponse.model_validate(dbuser)


def create_user(db: Session, payload: UserCreate, admin=None, service=None) -> UserResponse:
    dbuser = crud.create_user(db, payload, admin=admin, service=service)
    return UserResponse.model_validate(dbuser)


def update_user(db: Session, dbuser: User, payload: UserModify) -> UserResponse:
    updated = crud.update_user(db, dbuser, payload)
    return UserResponse.model_validate(updated)


def delete_user(db: Session, dbuser: User):
    crud.remove_user(db, dbuser)
    return dbuser
