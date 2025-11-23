#!/bin/bash

ln -s /code/rebecca-cli.py /usr/bin/rebecca-cli && chmod +x /usr/bin/rebecca-cli && rebecca-cli completion install --shell bash

# Wait for database to be ready
echo "Waiting for database to be ready..."
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
    if python -c "from app.db.base import engine; from sqlalchemy import text; engine.connect().execute(text('SELECT 1'))" 2>/dev/null; then
        echo "Database is ready!"
        break
    fi
    attempt=$((attempt + 1))
    echo "Attempt $attempt/$max_attempts: Database not ready yet, waiting 2 seconds..."
    sleep 2
done

if [ $attempt -eq $max_attempts ]; then
    echo "Warning: Database connection timeout, proceeding anyway..."
fi

# Run migrations with timeout
echo "Running database migrations..."
timeout 300 python -m alembic upgrade head || {
    echo "Migration failed or timed out, but continuing..."
    echo "You may need to run migrations manually: python -m alembic upgrade head"
}

# Start the application
python main.py