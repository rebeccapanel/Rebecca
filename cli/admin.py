from typing import Optional, Union

import typer
from decouple import UndefinedValueError, config
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app.db import GetDB, crud
from app.db.models import Admin, User
from app.models.admin import AdminCreate, AdminPartialModify, AdminRole
from app.utils.system import readable_size

from . import utils

app = typer.Typer(no_args_is_help=True)


def validate_telegram_id(value: Union[int, str]) -> Union[int, None]:
    if value in (None, "", 0, "0"):
        return 0
    if not isinstance(value, int):
        if not str(value).isdigit():
            raise typer.BadParameter("Telegram ID must be an integer.")
        value = int(value)
    if value < 0:
        raise typer.BadParameter("Telegram ID must be a positive integer.")
    return value


def parse_role(value: str) -> AdminRole:
    try:
        return AdminRole(value.lower())
    except ValueError as exc:
        raise typer.BadParameter("Role must be one of: standard, reseller, sudo, full_access.") from exc


def prompt_role_selection(current_role: Optional[AdminRole] = None) -> AdminRole:
    """Prompt user to select a role from a numbered list."""
    roles = [AdminRole.standard, AdminRole.reseller, AdminRole.sudo, AdminRole.full_access]
    roles_map = {str(i + 1): role for i, role in enumerate(roles)}
    
    Console().print("\nAvailable roles:")
    for i, role in enumerate(roles, 1):
        current_marker = " (current)" if current_role == role else ""
        Console().print(f"  {i}) {role.value}{current_marker}")
    Console().print()
    
    while True:
        if current_role:
            default_value = str(list(roles_map.values()).index(current_role) + 1)
        else:
            default_value = "1"
        
        choice = typer.prompt(
            "Select role",
            default=default_value,
            show_default=True,
        ).strip()
        
        if not choice and current_role:
            return current_role
        
        if not choice:
            choice = default_value
        
        if choice in roles_map:
            return roles_map[choice]
        
        try:
            return parse_role(choice)
        except typer.BadParameter:
            Console().print(f"[red]Invalid choice: {choice}. Please enter a number (1-4) or role name.[/red]")
            continue


def calculate_admin_usage(admin_id: int) -> str:
    with GetDB() as db:
        usage = db.query(func.sum(User.used_traffic)).filter_by(admin_id=admin_id).first()[0]
        return readable_size(int(usage or 0))


def calculate_admin_reseted_usage(admin_id: int) -> str:
    with GetDB() as db:
        usage = db.query(func.sum(User.reseted_usage)).filter_by(admin_id=admin_id).scalar()
        return readable_size(int(usage or 0))


@app.command(name="list")
def list_admins(
    offset: Optional[int] = typer.Option(None, *utils.FLAGS["offset"]),
    limit: Optional[int] = typer.Option(None, *utils.FLAGS["limit"]),
    username: Optional[str] = typer.Option(None, *utils.FLAGS["username"], help="Search by username"),
):
    """Displays a table of admins"""
    with GetDB() as db:
        admins: list[Admin] = crud.get_admins(db, offset=offset, limit=limit, username=username)
        rows = []
        for admin in admins:
            rows.append(
                (
                    str(admin.username),
                    calculate_admin_usage(admin.id),
                    calculate_admin_reseted_usage(admin.id),
                    readable_size(admin.users_usage),
                    admin.role.value,
                    utils.readable_datetime(admin.created_at),
                    str(admin.telegram_id or "-"),
                )
            )

        utils.print_table(
            table=Table(
                "Username",
                "Usage",
                "Reseted usage",
                "Users Usage",
                "Role",
                "Created at",
                "Telegram ID",
            ),
            rows=rows,
        )

@app.command(name="delete")
def delete_admin(
    username: str = typer.Option(..., *utils.FLAGS["username"], prompt=True),
    yes_to_all: bool = typer.Option(False, *utils.FLAGS["yes_to_all"], help="Skips confirmations")
):
    """
    Deletes the specified admin

    Confirmations can be skipped using `--yes/-y` option.
    """
    with GetDB() as db:
        admin: Union[Admin, None] = crud.get_admin(db, username=username)
        if not admin:
            utils.error(f"There's no admin with username \"{username}\"!")

        if yes_to_all or typer.confirm(f'Are you sure about deleting "{username}"?', default=False):
            crud.remove_admin(db, admin)
            utils.success(f'"{username}" deleted successfully.')
        else:
            utils.error("Operation aborted!")


@app.command(name="create")
def create_admin(
    username: str = typer.Option(..., *utils.FLAGS["username"], show_default=False, prompt=True),
    role: Optional[str] = typer.Option(
        None,
        *utils.FLAGS["role"],
        help="Admin role (1=standard, 2=reseller, 3=sudo, 4=full_access). If not provided, will prompt interactively.",
        prompt=False,
    ),
    password: str = typer.Option(..., prompt=True, confirmation_prompt=True,
                                 hide_input=True, hidden=True, envvar=utils.PASSWORD_ENVIRON_NAME),
    telegram_id: str = typer.Option('', *utils.FLAGS["telegram_id"], prompt="Telegram ID",
                                    show_default=False, callback=validate_telegram_id),
):
    """
    Creates an admin

    Password can also be set using the `REBECCA_ADMIN_PASSWORD` environment variable for non-interactive usages.
    """
    if role is None:
        selected_role = prompt_role_selection()
    else:
        selected_role = parse_role(role)
    
    with GetDB() as db:
        try:
            crud.create_admin(
                db,
                AdminCreate(
                    username=username,
                    password=password,
                    role=selected_role,
                    telegram_id=telegram_id,
                ),
            )
            utils.success(f'Admin "{username}" created successfully.')
        except IntegrityError:
            utils.error(f'Admin "{username}" already exists!')


@app.command(name="update")
def update_admin(username: str = typer.Option(..., *utils.FLAGS["username"], prompt=True, show_default=False)):
    """
    Updates the specified admin

    NOTE: This command CAN NOT be used non-interactively.
    """

    def _get_modify_model(admin: Admin):
        Console().print(
            Panel(f'Editing "{username}". Just press "Enter" to leave each field unchanged.')
        )

        new_role = prompt_role_selection(current_role=admin.role)
        role_to_set = new_role if new_role != admin.role else None
        
        new_password: Union[str, None] = typer.prompt(
            "New password",
            default="",
            show_default=False,
            confirmation_prompt=True,
            hide_input=True
        ) or None

        telegram_id: str = typer.prompt("Telegram ID (Enter 0 to clear current value)",
                                        default=admin.telegram_id or "")
        telegram_id = validate_telegram_id(telegram_id)

        return AdminPartialModify(
            role=role_to_set,
            password=new_password,
            telegram_id=telegram_id,
        )

    with GetDB() as db:
        admin: Union[Admin, None] = crud.get_admin(db, username=username)
        if not admin:
            utils.error(f"There's no admin with username \"{username}\"!")

        crud.partial_update_admin(db, admin, _get_modify_model(admin))
        utils.success(f'Admin "{username}" updated successfully.')


@app.command(name="change-role")
def change_role(
    username: str = typer.Option(..., *utils.FLAGS["username"], prompt=True, show_default=False),
    role: Optional[str] = typer.Option(
        None,
        *utils.FLAGS["role"],
        help="Target role (1=standard, 2=reseller, 3=sudo, 4=full_access). If not provided, will prompt interactively.",
    ),
    yes_to_all: bool = typer.Option(False, *utils.FLAGS["yes_to_all"], help="Skips confirmations"),
):
    """
    Changes an admin's role (e.g. promote a sudo admin to full access).
    """
    with GetDB() as db:
        admin: Union[Admin, None] = crud.get_admin(db, username=username)
        if not admin:
            utils.error(f"There's no admin with username \"{username}\"!")

        if role is None:
            target_role = prompt_role_selection(current_role=admin.role)
        else:
            target_role = parse_role(role)

        if admin.role == target_role:
            utils.success(f'Admin "{username}" is already {target_role.value}.')
            return

        if not yes_to_all and not typer.confirm(
            f'Change "{username}" role from {admin.role.value} to {target_role.value}?', default=False
        ):
            utils.error("Operation aborted!")

        crud.partial_update_admin(db, admin, AdminPartialModify(role=target_role))
        utils.success(f'Admin "{username}" role updated to {target_role.value}.')


@app.command(name="import-from-env")
def import_from_env(yes_to_all: bool = typer.Option(False, *utils.FLAGS["yes_to_all"], help="Skips confirmations")):
    """
    Imports the sudo admin from env

    Confirmations can be skipped using `--yes/-y` option.

    What does it do?
      - Creates a sudo admin according to `SUDO_USERNAME` and `SUDO_PASSWORD`.
      - Links any user which doesn't have an `admin_id` to the imported sudo admin.
    """
    try:
        username, password = config("SUDO_USERNAME"), config("SUDO_PASSWORD")
    except UndefinedValueError:
        utils.error(
            "Unable to get SUDO_USERNAME and/or SUDO_PASSWORD.\n"
            "Make sure you have set them in the env file or as environment variables."
        )

    if not (username and password):
        utils.error("Unable to retrieve username and password.\n"
                    "Make sure both SUDO_USERNAME and SUDO_PASSWORD are set.")

    with GetDB() as db:
        admin: Union[None, Admin] = None

        # If env admin already exists
        if current_admin := crud.get_admin(db, username=username):
            if not yes_to_all and not typer.confirm(
                f'Admin "{username}" already exists. Do you want to sync it with env?', default=None
            ):
                utils.error("Aborted.")

            admin = crud.partial_update_admin(
                db,
                current_admin,
                AdminPartialModify(password=password, role=AdminRole.full_access)
            )
        # If env admin does not exist yet
        else:
            admin = crud.create_admin(db, AdminCreate(
                username=username,
                password=password,
                role=AdminRole.full_access
            ))

        updated_user_count = db.query(User).filter_by(admin_id=None).update({"admin_id": admin.id})
        db.commit()

        utils.success(
            f'Admin "{username}" imported successfully.\n'
            f"{updated_user_count} users' admin_id set to the {username}'s id.\n"
            'You must delete SUDO_USERNAME and SUDO_PASSWORD from your env file now.'
        )
