# The agent service for the connector example: the same FastAPI app as the
# minimal example, plus the Postgres driver extra and two MCP servers.
#
# To run this example instead of the minimal one, point the `agent` service in
# ../minimal/docker-compose.yml at this directory:
#
#     agent:
#       build: ../with-connectors

FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py ./

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
