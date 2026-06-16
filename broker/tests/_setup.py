"""Path-fix shim — same pattern as web/tests/_setup.py."""

from __future__ import annotations

import pathlib
import sys

_BROKER = pathlib.Path(__file__).resolve().parent.parent
if str(_BROKER) not in sys.path:
    sys.path.insert(0, str(_BROKER))
