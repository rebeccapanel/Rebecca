ARG PYTHON_VERSION=3.13

FROM ghcr.io/astral-sh/uv:python$PYTHON_VERSION-bookworm-slim AS builder
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=0

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    libc6-dev \
    build-essential \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/rebecca/install_latest_xray.sh /tmp/install_latest_xray.sh

RUN bash /tmp/install_latest_xray.sh \
    && apt-get remove --purge -y curl unzip \
    && rm -f /tmp/install_latest_xray.sh \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-project --no-dev

ADD . /build

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

FROM python:$PYTHON_VERSION-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build /code
COPY --from=builder /usr/local/share/xray /usr/local/share/xray
COPY --from=builder /usr/local/bin/xray /usr/local/bin/xray

WORKDIR /code

ENV PATH="/code/.venv/bin:$PATH"

RUN chmod +x /code/scripts/entrypoint.sh

ENTRYPOINT ["/code/scripts/entrypoint.sh"]
