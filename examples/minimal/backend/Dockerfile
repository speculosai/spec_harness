# The agent service: this example's FastAPI app with the harness router mounted.
# Built by ../docker-compose.yml (and by the repo-root compose).

FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py ./

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
