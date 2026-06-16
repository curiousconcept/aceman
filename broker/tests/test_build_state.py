"""Tests for the build-state singleton.

Thread-safety is the entire point of the module — these tests
exercise concurrent reads/writes against a bounded log buffer to
catch a regression that would let a poll observe a half-updated
state.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import threading
import unittest

from aceman_broker.build_state import BuildState


class BuildStateTests(unittest.TestCase):
    def test_initial_state(self):
        b = BuildState()
        self.assertEqual(b.state(), "unknown")
        self.assertIsNone(b.error())
        self.assertEqual(b.tail(), [])
        self.assertFalse(b.is_busy())

    def test_transition_clears_error(self):
        b = BuildState()
        b.transition("failed", error="oops")
        self.assertEqual(b.error(), "oops")
        b.transition("building")
        self.assertIsNone(b.error())

    def test_log_capped_to_cap(self):
        b = BuildState(cap=3)
        for i in range(10):
            b.append_line(f"line {i}")
        # Only the last 3 lines are kept.
        self.assertEqual(b.tail(), ["line 7", "line 8", "line 9"])

    def test_clear_log(self):
        b = BuildState()
        b.append_line("x")
        b.clear_log()
        self.assertEqual(b.tail(), [])

    def test_is_busy_tracks_thread(self):
        b = BuildState()
        # Use an Event that we hold long enough to verify is_busy()
        # while it's alive, then release so the thread can exit.
        gate = threading.Event()
        t = threading.Thread(target=gate.wait, daemon=True)
        b.attach_thread(t)
        t.start()
        try:
            self.assertTrue(b.is_busy())
        finally:
            gate.set()
            t.join(timeout=1)
        self.assertFalse(b.is_busy())

    def test_concurrent_appends_dont_lose_lines(self):
        # 8 threads appending 100 lines each = 800 lines total. With
        # the lock, every append is observed; without it the deque
        # would race and we'd lose some.
        b = BuildState(cap=10_000)

        def worker(prefix):
            for i in range(100):
                b.append_line(f"{prefix}-{i}")

        threads = [threading.Thread(target=worker, args=(f"t{j}",))
                   for j in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(b.tail()), 800)


if __name__ == "__main__":
    unittest.main()
