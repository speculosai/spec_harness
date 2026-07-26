# The agent service: this example's FastAPI app with the harness router mounted.
#
# The build context is the repository root (see the compose files), so the image
# installs the agent kit from this checkout rather than from PyPI. That is what
# lets a fresh clone run before anything is published.

FROM python:3.12-slim

WORKDIR /app

# The agent kit, installed from source. Copied before the example so editing
# main.py does not reinstall the dependency tree.
COPY py/speculos_harness /app/kit
RUN pip install --no-cache-dir /app/kit "uvicorn[standard]>=0.29"

COPY examples/minimal/backend/main.py ./

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
