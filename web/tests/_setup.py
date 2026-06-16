"""Path-fix shim for the test suite.

Each test module imports this first so ``web/`` ends up on
``sys.path`` regardless of where ``unittest discover`` was invoked
from. Keeps the tests stdlib-only — no setuptools-style package
discovery, no PYTHONPATH gymnastics required."""

from __future__ import annotations

import pathlib
import sys

# tests/ → web/
_WEB = pathlib.Path(__file__).resolve().parent.parent
if str(_WEB) not in sys.path:
    sys.path.insert(0, str(_WEB))
