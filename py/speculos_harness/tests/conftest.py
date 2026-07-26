"""Shared test configuration.

The async tests are driven by anyio; pin the backend to asyncio so the suite does
not require trio to be installed.
"""

import pytest


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
