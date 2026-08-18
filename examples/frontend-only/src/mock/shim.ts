/**
 * The `data` connector's in-iframe half.
 *
 * The mock returns this string as `connectors.shim` on every bundle response. The
 * package folds it into the preview document *after* its own bridge preamble, so
 * `window.__harnessBridge` and `window.__harnessRegister` already exist by the time
 * this runs - see `makeShim()` in `@speculosai/spec_harness/preview`.
 *
 * Registering `data` is what turns
 *
 * ```ts
 * const { rows } = await window.app.data.query('units');
 * await window.app.data.call('send_reminder', { paymentId });
 * ```
 *
 * into a `postMessage` the parent answers from `POST /connectors/data`. `send()` never
 * rejects: a parent-side error, a dead frame or the 60-second timeout all resolve to
 * the empty shape plus an `error` key, so one bad data call can never take the
 * preview down.
 *
 * It is plain ES5 in a template literal, not TypeScript, because it is *transported*,
 * not compiled: the bundler never sees it and the frame runs it verbatim.
 */
export const DATA_SHIM = `
window.__harnessRegister('data', {
  query: function (table) {
    return window.__harnessBridge.send(
      { type: window.__harnessBridge.ns + '-data', op: 'query', table: table },
      function (d) { return { rows: Array.isArray(d.rows) ? d.rows : [] }; },
      { rows: [] });
  },
  call: function (name, args) {
    return window.__harnessBridge.send(
      { type: window.__harnessBridge.ns + '-data', op: 'call', name: name, args: args || {} },
      function (d) { return { result: 'result' in d ? d.result : null }; },
      { result: null });
  }
});
`;
