#!/bin/bash

ln -s /code/rebecca-cli.py /usr/bin/rebecca-cli && chmod +x /usr/bin/rebecca-cli && rebecca-cli completion install --shell bash

python -m alembic upgrade head
python main.py