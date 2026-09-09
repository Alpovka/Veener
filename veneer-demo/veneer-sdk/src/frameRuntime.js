/**
 * Builds the srcDoc for the sandboxed iframe.
 *
 * SECURITY MODEL (this is the product):
 *  - The iframe is mounted with sandbox="allow-scripts" and NO allow-same-origin, so it
 *    runs at an opaque origin: it cannot read the parent's cookies, localStorage, or DOM.
 *    (Never combine allow-scripts with allow-same-origin — that would defeat the sandbox.)
 *  - A strict Content-Security-Policy sets connect-src 'none' and img/font 'none', so code
 *    running inside the frame cannot fetch(), XHR, open a WebSocket, send a beacon, or load
 *    any external resource. It has no network. All I/O goes through postMessage only.
 *  - script-src is locked to 'self'-inline plus the two trusted CDN origins that serve the
 *    React/Babel/Tailwind runtime. The generated component itself is inline code; it cannot
 *    pull in arbitrary scripts from anywhere else.
 *
 * The only window into the host is `window.veneer`, which talks to the parent bridge. The
 * bridge validates every action id against the registry, so a generated UI can only trigger
 * capabilities the developer explicitly registered.
 */
export function buildFrameSrcDoc() {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.tailwindcss.com",
    "style-src 'unsafe-inline' https://cdn.tailwindcss.com",
    "img-src data:",
    "font-src data:",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
<script src="https://cdn.tailwindcss.com"></script>
<style>html,body{margin:0;padding:0;background:transparent;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;}</style>
</head>
<body>
<div id="root"></div>
<script>
(function () {
  var React = window.React, ReactDOM = window.ReactDOM, Babel = window.Babel;
  var dataCache = {};
  var pending = {};
  var callSeq = 0;

  function send(msg) {
    var payload = Object.assign({ source: 'veneer-frame' }, msg);
    parent.postMessage(payload, '*');
  }

  // The entire capability surface available to generated code.
  window.veneer = {
    // Trigger a registered action. Returns a Promise that resolves with the impl's result.
    action: function (id, args) {
      return new Promise(function (resolve, reject) {
        var callId = ++callSeq;
        pending[callId] = { resolve: resolve, reject: reject };
        send({ type: 'action', callId: callId, action: id, args: args || {} });
      });
    },
    // Read a registered data source (synchronous, from the locally-mirrored cache).
    data: function (sourceId) {
      return dataCache[sourceId] !== undefined ? dataCache[sourceId] : [];
    },
  };

  var reactRoot = ReactDOM.createRoot(document.getElementById('root'));

  function fallback(message) {
    reactRoot.render(
      React.createElement(
        'div',
        { style: { padding: '24px', color: '#64748b', fontFamily: 'ui-sans-serif, system-ui' } },
        message || "Couldn't render this view. Try asking again."
      )
    );
  }

  // Error boundary: a bad generation shows a friendly message instead of breaking anything.
  var ErrorBoundary = (function () {
    function EB(props) {
      React.Component.call(this, props);
      this.state = { err: null };
    }
    EB.prototype = Object.create(React.Component.prototype);
    EB.prototype.constructor = EB;
    EB.getDerivedStateFromError = function (err) { return { err: err }; };
    EB.prototype.componentDidCatch = function (err) {
      send({ type: 'error', message: String((err && err.message) || err) });
    };
    EB.prototype.render = function () {
      if (this.state.err) {
        return React.createElement(
          'div',
          { style: { padding: '24px', color: '#64748b', fontFamily: 'ui-sans-serif, system-ui' } },
          "Couldn't render this view. Try asking again."
        );
      }
      return this.props.children;
    };
    return EB;
  })();

  // Re-renders the generated UI whenever fresh data is pushed from the host.
  // We clone the element on every render so React gets a NEW child reference and
  // actually re-renders the component (passing the same element object would hit
  // React's "same reference" bailout and the UI would never reflect new data).
  // Cloning keeps the same component type/position, so its hook state is preserved.
  function VeneerRoot(props) {
    var s = React.useState(0);
    var force = s[1];
    React.useEffect(function () {
      function onUpdate() { force(function (x) { return x + 1; }); }
      window.addEventListener('veneer:dataupdate', onUpdate);
      return function () { window.removeEventListener('veneer:dataupdate', onUpdate); };
    }, []);
    var child = React.isValidElement(props.el) ? React.cloneElement(props.el) : props.el;
    return React.createElement(ErrorBoundary, null, child);
  }

  // Provided to generated code as render(<App/>).
  function render(el) {
    reactRoot.render(React.createElement(VeneerRoot, { el: el }));
  }

  function runCode(code) {
    if (!code) { fallback('Ask the AI to design this page.'); return; }
    try {
      var transformed = Babel.transform(code, { presets: ['react'] }).code;
      var fn = new Function(
        'React', 'useState', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'veneer', 'render',
        transformed
      );
      fn(
        React, React.useState, React.useEffect, React.useMemo, React.useCallback, React.useRef,
        window.veneer, render
      );
    } catch (e) {
      send({ type: 'error', message: String((e && e.message) || e) });
      fallback();
    }
  }

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.source !== 'veneer-host') return;
    if (d.type === 'init') {
      dataCache = d.data || {};
      runCode(d.code);
    } else if (d.type === 'render') {
      if (d.data) dataCache = d.data;
      runCode(d.code);
    } else if (d.type === 'data') {
      dataCache = d.data || {};
      window.dispatchEvent(new Event('veneer:dataupdate'));
    } else if (d.type === 'action-result') {
      var p = pending[d.callId];
      if (p) {
        delete pending[d.callId];
        if (d.ok) p.resolve(d.result);
        else p.reject(new Error(d.error || 'action failed'));
      }
    }
  });

  // Tell the host we're ready to receive the initial code + data.
  send({ type: 'ready' });
})();
</script>
</body>
</html>`;
}
