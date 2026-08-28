FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

WORKDIR /build
COPY pyproject.toml uv.lock ./
RUN uv export --frozen --no-dev --no-hashes --no-emit-project -o requirements.txt

FROM public.ecr.aws/lambda/python:3.12

COPY --from=builder /build/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --target "${LAMBDA_TASK_ROOT}"

COPY src/radar_ingest ${LAMBDA_TASK_ROOT}/radar_ingest

CMD ["radar_ingest.app.handler"]
