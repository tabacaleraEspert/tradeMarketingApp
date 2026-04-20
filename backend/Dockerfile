FROM python:3.13-slim

WORKDIR /app

# System deps for pymssql + Pillow
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libffi-dev freetds-dev libjpeg-dev zlib1g-dev && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Crear directorio para uploads locales (fallback si no hay Azure Blob)
RUN mkdir -p /app/uploads

EXPOSE 8000

# startup.sh corre Alembic migrations + Gunicorn
RUN chmod +x startup.sh
CMD ["./startup.sh"]
