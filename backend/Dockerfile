FROM python:3.13-slim

WORKDIR /app

# System deps for pymssql
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libffi-dev freetds-dev && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["gunicorn", "-w", "2", "-k", "uvicorn.workers.UvicornWorker", "app.main:app", "--bind", "0.0.0.0:8000", "--timeout", "120"]
