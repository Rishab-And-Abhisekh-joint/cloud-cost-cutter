FROM python:3.11-slim

WORKDIR /app

COPY . /app

RUN pip install --no-cache-dir -e .

EXPOSE 8000

CMD ["uvicorn", "cloud_cost_env.server.app:create_fastapi_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
