"""Built-in agent tools.

The five file/package tools every agent turn can call, co-located as
:class:`~speculos_harness.interfaces.AgentTool` implementations. Connector
plugins contribute their own tools on top of these.
"""

from __future__ import annotations

from .files import (
    DeleteFileTool,
    EditFileTool,
    InstallPackageTool,
    ReadFileTool,
    WriteFileTool,
    WriteValidator,
    builtin_file_tools,
    inlined_dataset_validator,
    InlinedDatasetError,
)

__all__ = [
    "WriteFileTool",
    "EditFileTool",
    "ReadFileTool",
    "DeleteFileTool",
    "InstallPackageTool",
    "WriteValidator",
    "builtin_file_tools",
    "inlined_dataset_validator",
    "InlinedDatasetError",
]
