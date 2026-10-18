"""Trivial sample module for the worker toolchain."""
import os  # HEN-56 demo: deliberate unused import (F401), reverted in the next commit


def format_worker_greeting(worker_name: str) -> str:
    """Return a greeting for the given worker name."""
    return f"Hello from {worker_name}"
