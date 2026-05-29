"""case insensitive username

Revision ID: fad8b1997c3a
Revises: 5b84d88804a1
Create Date: 2023-03-17 22:46:32.833004

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import func, select, update
import pymysql

# revision identifiers, used by Alembic.
revision = 'fad8b1997c3a'
down_revision = '5b84d88804a1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_indexes = {index['name'] for index in inspector.get_indexes('users')}

    if bind.engine.name == 'mysql':
        # MySQL is case-insensitive by default, no action needed
        # But we need to ensure the index exists
        # Check directly in MySQL information_schema to be sure (more reliable than inspector)
        try:
            result = bind.execute(
                sa.text("""
                    SELECT COUNT(*) as cnt 
                    FROM information_schema.statistics 
                    WHERE table_schema = DATABASE() 
                    AND table_name = 'users' 
                    AND index_name = 'ix_users_username'
                """)
            ).scalar()
            
            if result == 0:
                # Index doesn't exist, try to create it
                try:
                    op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)
                except Exception as e:
                    # Check for duplicate key error (MySQL error 1061)
                    # SQLAlchemy wraps pymysql errors, so check both the message and the original error
                    error_msg = str(e).lower()
                    error_repr = repr(e).lower()
                    
                    # Check error message and representation for duplicate key indicators
                    is_duplicate_error = (
                        'duplicate' in error_msg or 
                        'duplicate' in error_repr or
                        'already exists' in error_msg or 
                        '1061' in error_msg or
                        '1061' in error_repr or
                        'ix_users_username' in error_msg
                    )
                    
                    # Check original error if wrapped by SQLAlchemy
                    if not is_duplicate_error and hasattr(e, 'orig'):
                        orig = e.orig
                        if isinstance(orig, (pymysql.err.OperationalError,)):
                            if hasattr(orig, 'args') and len(orig.args) > 0:
                                # pymysql format: (1061, "Duplicate key name 'ix_users_username'")
                                if isinstance(orig.args[0], tuple) and len(orig.args[0]) > 0:
                                    if orig.args[0][0] == 1061:
                                        is_duplicate_error = True
                                elif isinstance(orig.args[0], int) and orig.args[0] == 1061:
                                    is_duplicate_error = True
                    
                    # If it's not a duplicate error, re-raise
                    if not is_duplicate_error:
                        raise
                    # Otherwise, silently ignore (index already exists)
        except Exception:
            # If information_schema query fails, fall back to inspector
            inspector = sa.inspect(bind)
            existing_indexes = {index['name'] for index in inspector.get_indexes('users')}
            if 'ix_users_username' not in existing_indexes:
                try:
                    op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)
                except Exception as create_error:
                    # Check for duplicate key error (MySQL error 1061)
                    # SQLAlchemy wraps pymysql errors, so check both the message and the original error
                    error_msg = str(create_error).lower()
                    error_repr = repr(create_error).lower()
                    
                    # Check error message and representation for duplicate key indicators
                    is_duplicate_error = (
                        'duplicate' in error_msg or 
                        'duplicate' in error_repr or
                        'already exists' in error_msg or 
                        '1061' in error_msg or
                        '1061' in error_repr or
                        'ix_users_username' in error_msg
                    )
                    
                    # Check original error if wrapped by SQLAlchemy
                    if not is_duplicate_error and hasattr(create_error, 'orig'):
                        orig = create_error.orig
                        if isinstance(orig, (pymysql.err.OperationalError,)):
                            if hasattr(orig, 'args') and len(orig.args) > 0:
                                # pymysql format: (1061, "Duplicate key name 'ix_users_username'")
                                if isinstance(orig.args[0], tuple) and len(orig.args[0]) > 0:
                                    if orig.args[0][0] == 1061:
                                        is_duplicate_error = True
                                elif isinstance(orig.args[0], int) and orig.args[0] == 1061:
                                    is_duplicate_error = True
                    
                    # If it's not a duplicate error, re-raise
                    if not is_duplicate_error:
                        raise
                    # Otherwise, silently ignore (index already exists)
        return

    elif bind.engine.name == 'sqlite':
        table_sql = bind.execute(
            sa.text("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
        ).scalar()
        if table_sql and 'COLLATE NOCASE' in table_sql.upper():
            # Index might already exist, check and create if needed
            if 'ix_users_username' not in existing_indexes:
                try:
                    op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)
                except Exception as e:
                    # Index might already exist, check if it's a duplicate key error
                    error_msg = str(e).lower()
                    if 'duplicate' not in error_msg and 'already exists' not in error_msg:
                        # Re-raise if it's a different error
                        raise
            return

        if 'ix_users_username' in existing_indexes:
            try:
                op.drop_index('ix_users_username', table_name='users')
            except Exception:
                # Index might not exist, continue
                pass
            # Refresh inspector after drop
            inspector = sa.inspect(bind)
            existing_indexes = {index['name'] for index in inspector.get_indexes('users')}

        # Define the 'users' table for SQLAlchemy Core operations
        users_table = sa.Table(
            'users',
            sa.MetaData(),
            sa.Column('id', sa.Integer, primary_key=True),
            sa.Column('username', sa.String(34, collation='NOCASE'))
        )

        # Identify and resolve duplicate usernames with a case-insensitive check
        connection = op.get_bind()

        while True:
            # Use SQLAlchemy Core to find duplicates with COLLATE NOCASE
            duplicate_query = (
                select(users_table.c.username, func.count())
                .group_by(users_table.c.username.collate("NOCASE"))
                .having(func.count() > 1)
            )
            duplicates = connection.execute(duplicate_query).fetchall()

            if not duplicates:
                break  # No duplicates, exit the loop

            # Resolve duplicates
            for username, count in duplicates:
                # Update rows with duplicate usernames
                update_stmt = (
                    update(users_table)
                    .where(users_table.c.username == username)
                    .values(username=f"{username}_{count}")
                )
                connection.execute(update_stmt)

        # Alter column to enforce case-insensitivity
        with op.batch_alter_table('users') as batch_op:
            batch_op.alter_column('username', type_=sa.String(length=34, collation='NOCASE'))

        # Recreate the unique index (check if it doesn't exist)
        inspector = sa.inspect(bind)
        existing_indexes = {index['name'] for index in inspector.get_indexes('users')}
        if 'ix_users_username' not in existing_indexes:
            try:
                op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)
            except Exception as e:
                # Index might already exist, check if it's a duplicate key error
                error_msg = str(e).lower()
                if 'duplicate' not in error_msg and 'already exists' not in error_msg:
                    # Re-raise if it's a different error
                    raise
    else:
        # For other databases (PostgreSQL, etc.), check if index exists before creating
        if 'ix_users_username' not in existing_indexes:
            try:
                op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)
            except Exception as e:
                # Index might already exist, check if it's a duplicate key error
                error_msg = str(e).lower()
                if 'duplicate' not in error_msg and 'already exists' not in error_msg:
                    # Re-raise if it's a different error
                    raise


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_indexes = {index['name'] for index in inspector.get_indexes('users')}

    if bind.engine.name == 'mysql':
        pass  # MySQL remains unchanged

    elif bind.engine.name == 'sqlite':
        table_sql = bind.execute(
            sa.text("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
        ).scalar()
        if not table_sql or 'COLLATE NOCASE' not in table_sql.upper():
            return

        with op.batch_alter_table('users') as batch_op:
            batch_op.alter_column('username', type_=sa.String(length=34))

        if 'ix_users_username' in existing_indexes:
            try:
                op.drop_index('ix_users_username', table_name='users')
            except Exception:
                # Index might not exist, continue
                pass
        # Refresh inspector after drop
        inspector = sa.inspect(bind)
        existing_indexes = {index['name'] for index in inspector.get_indexes('users')}
        if 'ix_users_username' not in existing_indexes:
            try:
                op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)
            except Exception as e:
                # Index might already exist, check if it's a duplicate key error
                error_msg = str(e).lower()
                if 'duplicate' not in error_msg and 'already exists' not in error_msg:
                    # Re-raise if it's a different error
                    raise
    else:
        # For other databases, ensure index exists
        if 'ix_users_username' not in existing_indexes:
            try:
                op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)
            except Exception as e:
                # Index might already exist, check if it's a duplicate key error
                error_msg = str(e).lower()
                if 'duplicate' not in error_msg and 'already exists' not in error_msg:
                    # Re-raise if it's a different error
                    raise
