"""The shared in-iframe bridge preamble every connector shim carries.

A connector's ``shim(summary, ns)`` contribution is a JS source string that the
preview injects into the null-origin iframe. Contributions can be injected
before or after the core shim and in any order, so each one carries this
preamble and installs the two globals itself if they are missing. Both
installers are idempotent, so including the preamble N times costs nothing.

``window.__harnessBridge.send(payload, unwrap, emptyShape)``
    Posts a correlated ``{type: '<ns>-<kind>', id, ...}`` request to the parent
    and resolves with the matching ``<ns>-result``. It **never rejects**: a
    parent-side error, a failed ``postMessage`` or the 60-second timeout all
    resolve to ``emptyShape`` plus an ``error`` key, so a data call can never
    take the preview down. See ``spec/preview-bridge.md``.

``window.__harnessRegister(name, api)``
    Publishes a connector onto ``window.__harnessConnectors`` - the object the
    core shim wraps in its never-throw ``Proxy`` - and, when the namespace
    object already exists, onto ``window[ns]`` directly. A hyphenated name is
    also registered under its snake_case alias, because generated code reaches
    for ``window.app.my_db`` rather than ``window.app['my-db']``.
"""

from __future__ import annotations

import json

#: Matches ``BRIDGE_TIMEOUT_MS`` in ``@speculos-harness/protocol``. Every
#: bridge request times out here rather than hanging the app forever.
BRIDGE_TIMEOUT_MS = 60_000


def bridge_preamble(ns: str) -> str:
    """Render the preamble for one namespace. Safe to include more than once."""
    ns_js = json.dumps(ns)
    return f"""
(function () {{
  var NS = {ns_js};
  if (!window.__harnessBridge) {{
    var pending = Object.create(null);
    window.addEventListener('message', function (e) {{
      var d = e && e.data;
      if (!d || d.type !== NS + '-result') return;
      var fn = pending[d.id];
      if (!fn) return;
      delete pending[d.id];
      fn(d);
    }});
    window.__harnessBridge = {{
      ns: NS,
      send: function (payload, unwrap, emptyShape) {{
        return new Promise(function (resolve) {{
          var id = 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2);
          payload.id = id;
          var settled = false;
          pending[id] = function (d) {{
            settled = true;
            if (d && d.error) resolve(Object.assign({{}}, emptyShape, {{ error: d.error }}));
            else resolve(unwrap(d));
          }};
          try {{
            parent.postMessage(payload, '*');
          }} catch (err) {{
            delete pending[id];
            resolve(Object.assign({{}}, emptyShape, {{
              error: 'postMessage to parent failed: ' + (err && err.message)
            }}));
            return;
          }}
          setTimeout(function () {{
            if (settled) return;
            delete pending[id];
            resolve(Object.assign({{}}, emptyShape, {{
              error: 'Request timed out after {BRIDGE_TIMEOUT_MS // 1000}s'
            }}));
          }}, {BRIDGE_TIMEOUT_MS});
        }});
      }}
    }};
  }}
  if (!window.__harnessRegister) {{
    window.__harnessConnectors = window.__harnessConnectors || {{}};
    window.__harnessRegister = function (name, api) {{
      window.__harnessConnectors[name] = api;
      var snake = String(name).replace(/-/g, '_');
      if (snake !== name) window.__harnessConnectors[snake] = api;
      var host = window[NS];
      if (host && typeof host === 'object') {{
        try {{
          host[name] = api;
          if (snake !== name) host[snake] = api;
        }} catch (e) {{}}
      }}
    }};
  }}
}})();
"""
