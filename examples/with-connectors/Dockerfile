# The agent service for the connector example: the same FastAPI app as the
# minimal example, plus the Postgres driver extra and two MCP servers.
#
# Like the minimal example, the build context is the repository root, so the
# image installs the agent kit from this checkout rather than from PyPI. That
# is what lets a fresh clone run before anything is published. To run this
# example instead of the minimal one, point the `agent` service in
# ../minimal/docker-compose.yml at this Dockerfile:
#
#     agent:
#       build:
#         context: ../..
#         dockerfile: examples/with-connectors/Dockerfile

FROM python:3.12-slim

WORKDIR /app

# The agent kit with the Postgres extra, installed from source. Copied before
# the example so editing main.py does not reinstall the dependency tree.
COPY py/speculos_harness /app/kit
RUN pip install --no-cache-dir "/app/kit[postgres]" "uvicorn[standard]>=0.29"

COPY examples/with-connectors/main.py ./

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
