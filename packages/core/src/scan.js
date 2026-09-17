/**
 * Static scan of generated code.
 *
 * `createScanner(parser, traverse)` is deliberately SELF-CONTAINED (no imports, no references
 * to module scope): its source is inlined into the sandbox document via `Function.prototype
 * .toString()` and evaluated there against Babel standalone's bundled parser/traverse, and it
 * is also used on the server against @babel/parser + @babel/traverse. Keep it that way.
 *
 * WHAT THIS IS: lint against model mistakes and a speed bump for tampered storage. It rejects
 * code that reaches for the window/document/network, uses `this`, imports anything, or calls
 * `veneer.action` / `veneer.data` with a non-literal or unregistered id.
 *
 * WHAT THIS IS NOT: the security boundary. With `'unsafe-eval'` in the sandbox any static
 * check is bypassable (`globalThis[atob('bG9jYXRpb24=')]`). The boundary is the sandboxed
 * opaque origin + CSP + the validated MessageChannel bridge (see bridge.js / VeneerFrame.js).
 */
export function createScanner(parser, traverse) {
  var FORBIDDEN_GLOBALS = [
    'window', 'document', 'globalThis', 'self', 'top', 'parent', 'frames', 'frameElement',
    'location', 'navigator', 'history', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
    'eval', 'Function', 'importScripts', 'open', 'indexedDB', 'caches', 'cookieStore',
    'localStorage', 'sessionStorage', 'postMessage', 'Worker', 'SharedWorker', 'Babel',
    'require', 'module', 'exports', 'process', 'ReactDOM',
  ];
  var FORBIDDEN_MEMBERS = ['constructor', '__proto__', 'prototype', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__'];
  var FORBIDDEN_JSX_ATTRS = ['dangerouslySetInnerHTML', 'srcDoc', 'srcdoc', 'httpEquiv', 'formAction', 'formaction'];
  // Elements that can reach the network or the document without CSP coverage (dns-prefetch, meta refresh…).
  var FORBIDDEN_JSX_ELEMENTS = ['link', 'meta', 'base', 'iframe', 'frame', 'object', 'embed', 'script', 'style', 'html', 'head', 'body', 'title'];
  var VENEER_METHODS = ['action', 'data'];

  function has(list, name) {
    for (var i = 0; i < list.length; i++) if (list[i] === name) return true;
    return false;
  }

  function literalString(node) {
    if (!node) return null;
    if (node.type === 'StringLiteral') return node.value;
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0 && node.quasis.length === 1) {
      return node.quasis[0].value.cooked;
    }
    return null;
  }

  // String-producing helpers that can assemble a forbidden property name at runtime.
  var STRING_BUILDERS = ['join', 'concat', 'replace', 'replaceAll', 'toLowerCase', 'toUpperCase', 'fromCharCode', 'fromCodePoint', 'trim', 'slice', 'substring', 'substr', 'padStart', 'padEnd', 'repeat', 'normalize', 'reverse'];
  var STRING_BUILDER_FUNCTIONS = ['String', 'atob', 'decodeURIComponent', 'decodeURI', 'unescape'];

  /**
   * Does this computed key *build a string* at runtime? `obj['con' + 'structor']`, obj[`${a}b`],
   * obj[['c','o'].join('')] and obj[atob('...')] exist only to dodge the FORBIDDEN_MEMBERS check.
   * Numeric indexing (`arr[i - 1]`, `months[parseInt(x) - 1]`, `list[i % n]`) and lookups with
   * a plain identifier or a literal are normal UI code and pass.
   */
  function buildsString(node) {
    if (!node) return false;
    if (node.type === 'TemplateLiteral') return node.expressions.length > 0;
    if (node.type === 'BinaryExpression') {
      if (node.operator !== '+') return false;
      var l = node.left, r = node.right;
      return l.type === 'StringLiteral' || r.type === 'StringLiteral' || l.type === 'TemplateLiteral' || r.type === 'TemplateLiteral' || buildsString(l) || buildsString(r);
    }
    if (node.type === 'ConditionalExpression') return buildsString(node.consequent) || buildsString(node.alternate);
    if (node.type === 'LogicalExpression') return buildsString(node.left) || buildsString(node.right);
    if (node.type === 'SequenceExpression') return buildsString(node.expressions[node.expressions.length - 1]);
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      var c = node.callee;
      if (c.type === 'Identifier') return has(STRING_BUILDER_FUNCTIONS, c.name);
      if (c.type === 'MemberExpression' || c.type === 'OptionalMemberExpression') {
        var m = c.property && (c.property.type === 'Identifier' && !c.computed ? c.property.name : literalString(c.property));
        return !!m && has(STRING_BUILDERS, m);
      }
      return false;
    }
    return false;
  }

  function memberName(node) {
    if (!node.computed && node.property && node.property.type === 'Identifier') return node.property.name;
    if (node.computed) return literalString(node.property);
    return null;
  }

  /**
   * @param {string} code  generated JSX source
   * @param {{ actionIds?: string[], dataIds?: string[] }} registry ids the bridge will accept
   * @returns {{ ok: boolean, violations: string[] }}
   */
  return function scan(code, registry) {
    var violations = [];
    var actionIds = (registry && registry.actionIds) || [];
    var dataIds = (registry && registry.dataIds) || [];
    if (typeof code !== 'string') return { ok: false, violations: ['code must be a string'] };
    var ast;
    try {
      ast = parser.parse(code, { sourceType: 'script', plugins: ['jsx'], errorRecovery: false });
    } catch (e) {
      return { ok: false, violations: ['syntax error: ' + String((e && e.message) || e)] };
    }
    function add(msg, node) {
      var loc = node && node.loc ? ' (line ' + node.loc.start.line + ')' : '';
      if (violations.length < 50) violations.push(msg + loc);
    }
    var isFree = function (path, name) {
      return !path.scope.hasBinding(name, { noGlobals: true });
    };

    traverse(ast, {
      ImportDeclaration: function (p) { add('import is not allowed', p.node); },
      ExportNamedDeclaration: function (p) { add('export is not allowed', p.node); },
      ExportDefaultDeclaration: function (p) { add('export is not allowed', p.node); },
      ExportAllDeclaration: function (p) { add('export is not allowed', p.node); },
      Import: function (p) { add('dynamic import() is not allowed', p.node); },
      ImportExpression: function (p) { add('dynamic import() is not allowed', p.node); },
      MetaProperty: function (p) { add('import.meta / new.target is not allowed', p.node); },
      WithStatement: function (p) { add('with statement is not allowed', p.node); },
      ThisExpression: function (p) { add('`this` is not allowed; use function components and closures', p.node); },
      DebuggerStatement: function (p) { add('debugger is not allowed', p.node); },
      Identifier: function (p) {
        var name = p.node.name;
        if (!has(FORBIDDEN_GLOBALS, name)) return;
        if (!p.isReferencedIdentifier()) return;
        // `obj.window` is a property access, not the global.
        var parent = p.parent;
        if (parent && parent.type === 'MemberExpression' && parent.property === p.node && !parent.computed) return;
        if (parent && parent.type === 'OptionalMemberExpression' && parent.property === p.node && !parent.computed) return;
        if (isFree(p, name)) add('access to global `' + name + '` is not allowed', p.node);
      },
      'MemberExpression|OptionalMemberExpression': function (p) {
        var name = memberName(p.node);
        if (name && has(FORBIDDEN_MEMBERS, name)) add('access to `.' + name + '` is not allowed', p.node);
        // obj['con' + 'structor'] / obj[`${x}`] / obj[[...].join('')]: string-built keys exist only to dodge the check above.
        if (p.node.computed && buildsString(p.node.property)) add('computed property access with a constructed key is not allowed', p.node);
        // veneer[...] must be a literal 'action' / 'data'
        var obj = p.node.object;
        if (obj && obj.type === 'Identifier' && obj.name === 'veneer' && isFree(p, 'veneer')) {
          if (!name || !has(VENEER_METHODS, name)) add('only veneer.action and veneer.data may be used', p.node);
        }
      },
      JSXOpeningElement: function (p) {
        var n = p.node.name;
        var tag = n && n.type === 'JSXIdentifier' ? n.name : '';
        if (tag && has(FORBIDDEN_JSX_ELEMENTS, tag.toLowerCase()) && tag[0] === tag[0].toLowerCase()) add('element <' + tag + '> is not allowed', p.node);
      },
      JSXAttribute: function (p) {
        var n = p.node.name;
        var attr = n && n.type === 'JSXIdentifier' ? n.name : (n && n.name && n.name.name) || '';
        if (has(FORBIDDEN_JSX_ATTRS, attr)) add('JSX attribute `' + attr + '` is not allowed', p.node);
        if (attr === 'href' || attr === 'src' || attr === 'action') {
          var v = p.node.value;
          var s = v && v.type === 'StringLiteral' ? v.value : null;
          if (s !== null && /^\s*(javascript|data|vbscript):/i.test(s)) add('`' + attr + '` with a `' + s.split(':')[0] + ':` URL is not allowed', p.node);
        }
      },
      ObjectProperty: function (p) {
        var k = p.node.key;
        var keyName = !p.node.computed && k && k.type === 'Identifier' ? k.name : literalString(k);
        if (keyName && has(FORBIDDEN_JSX_ATTRS, keyName)) add('property `' + keyName + '` is not allowed', p.node);
        if (keyName === 'http-equiv') add('property `http-equiv` is not allowed', p.node);
      },
      'CallExpression|OptionalCallExpression': function (p) {
        var callee = p.node.callee;
        if (!callee) return;
        if (callee.type === 'Identifier' && (callee.name === 'setTimeout' || callee.name === 'setInterval') && isFree(p, callee.name)) {
          var first = p.node.arguments[0];
          var fn = first && (first.type === 'FunctionExpression' || first.type === 'ArrowFunctionExpression' || first.type === 'Identifier' || first.type === 'MemberExpression' || first.type === 'CallExpression');
          if (!fn) add(callee.name + '() requires a function argument (strings are eval)', p.node);
        }
        if ((callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') &&
            callee.object && callee.object.type === 'Identifier' && callee.object.name === 'veneer' &&
            isFree(p, 'veneer')) {
          var method = memberName(callee);
          var idNode = p.node.arguments[0];
          var id = literalString(idNode);
          if (method === 'action' || method === 'data') {
            if (id === null) { add('veneer.' + method + '() requires a string-literal id', p.node); return; }
            var allowed = method === 'action' ? actionIds : dataIds;
            if (!has(allowed, id)) add('veneer.' + method + '("' + id + '") is not a registered ' + (method === 'action' ? 'action' : 'data source'), p.node);
          }
        }
      },
    });

    return { ok: violations.length === 0, violations: violations };
  };
}

/** Registry → the id lists the scanner needs. Pure helper, safe on client and server. */
export function registryIds(registry) {
  var r = registry || {};
  return {
    actionIds: (r.actions || []).map(function (a) { return a.id; }),
    dataIds: (r.dataSources || []).map(function (d) { return d.id; }),
  };
}
