"""aceman_broker — package backing the host-side allow-list broker.

The broker is invoked as the ``broker/aceman-broker`` executable; the
script imports from this package so each unit can be tested without
touching podman / sockets / files on the host.

Current modules:

  validators        — env-name and request-param validation
  desktop_helpers   — Desktop Entry quoting (Exec= line escaping)
  desktop_template  — Desktop Entry body generation
  mimeapps          — regex + scrub for mimeapps.list aceman entries
"""

from __future__ import annotations
