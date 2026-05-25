(() => {
  'use strict';

  // ── PUA Unicode image tag delimiters ─────────────────────────────────────
  //   U+E001 = IMAGE_START   U+E002 = IMAGE_END
  //   Wire format in comments:  \uE001<url>\uE002
  //   Legacy bracket format [image=<url>] is auto-converted to PUA on input.
  const IMG_S = '\uE001';
  const IMG_E = '\uE002';
  const PUA_TAG_RE   = new RegExp(IMG_S + '([^' + IMG_E + '\\n]+)' + IMG_E, 'g');
  const LEGACY_TAG_RE = /\[image=([^\]\n]+)\]/g;

  // ── Alias map ─────────────────────────────────────────────────────────────
  const aliasMap = {
    pcd: 'cdn.fourvo.id',
    yt:  'i.ytimg.com',
    gh:  'raw.githubusercontent.com',
    mc:  'textures.minecraft.net',
  };

  // ── CSS (injected once) ───────────────────────────────────────────────────
  const PREVIEW_CLASS     = 'ytimg-composer-preview';
  const PREVIEW_IMG_CLASS = 'ytimg-composer-preview-img';
  const COMMENT_IMG_CLASS = 'ytimg-comment-img';
  const HINT_CLASS        = 'ytimg-composer-hint';

  const CSS = `
    /* ── composer preview strip ── */
    .${PREVIEW_CLASS} {
      margin-top: 8px;
      padding: 6px 0;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: flex-start;
    }
    .${PREVIEW_CLASS} img.${PREVIEW_IMG_CLASS} {
      max-width: 140px;
      max-height: 140px;
      border-radius: 8px;
      object-fit: cover;
      display: block;
      border: 1px solid rgba(255,255,255,.12);
    }
    .${PREVIEW_CLASS} .ytimg-broken {
      width: 140px;
      height: 90px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      background: #1a1a1a;
      color: #aaa;
      font-size: 11px;
      padding: 6px;
      box-sizing: border-box;
      text-align: center;
      border: 1px dashed #444;
    }
    /* ── format hint ── */
    .${HINT_CLASS} {
      margin-top: 4px;
      font-size: 11px;
      color: #888;
      font-family: monospace;
      user-select: text;
    }
    /* ── rendered images inside posted comments ── */
    img.${COMMENT_IMG_CLASS} {
      max-width: 280px;
      max-height: 280px;
      border-radius: 8px;
      margin: 6px 0;
      display: block;
      border: 1px solid rgba(255,255,255,.1);
    }
  `;

  (function injectCSS() {
    if (document.getElementById('ytimg-style')) return;
    const s = document.createElement('style');
    s.id = 'ytimg-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  })();

  // ── URL normalizer ────────────────────────────────────────────────────────
  // Supports:
  //   h://…          → http://…
  //   hs://…         → https://…
  //   hs://pcd/path  → https://cdn.fourvo.id/path   (alias expansion)
  //   .dic           → .id
  //   .cv            → .com
  //   .mcd           → .me
  function normalizeURL(raw) {
    if (!raw) return null;
    let url = raw.trim();
    if (!url) return null;

    // Expand shorthand schemes
    const schemeMatch = url.match(/^(hs|h):\/\/(.+)$/i);
    if (schemeMatch) {
      const scheme = schemeMatch[1].toLowerCase() === 'hs' ? 'https' : 'http';
      url = scheme + '://' + schemeMatch[2];
    }

    // Parse host + path
    const parsed = url.match(/^(https?):\/\/([^/]+)(\/.*)?$/i);
    if (parsed) {
      let scheme = parsed[1];
      let host   = parsed[2];
      let path   = parsed[3] || '';

      // Alias expansion
      if (aliasMap[host]) host = aliasMap[host];

      // TLD shorthands
      host = host
        .replace(/\.dic\b/gi, '.id')
        .replace(/\.cv\b/gi,  '.com')
        .replace(/\.mcd\b/gi, '.me');

      return `${scheme}://${host}${path}`;
    }

    // Bare host/path without scheme
    url = url
      .replace(/\.dic\b/gi, '.id')
      .replace(/\.cv\b/gi,  '.com')
      .replace(/\.mcd\b/gi, '.me');

    return url.startsWith('http') ? url : 'https://' + url;
  }

  // ── PUA encoding / decoding helpers ──────────────────────────────────────
  function encodePUA(rawUrl) {
    return IMG_S + rawUrl + IMG_E;
  }

  /** Collect all [rawUrl, normalizedUrl] pairs from a string (PUA or legacy) */
  function extractImageURLs(text) {
    const results = [];
    let m;

    PUA_TAG_RE.lastIndex = 0;
    while ((m = PUA_TAG_RE.exec(text)) !== null) {
      const n = normalizeURL(m[1]);
      if (n) results.push({ raw: m[1], url: n, full: m[0] });
    }

    LEGACY_TAG_RE.lastIndex = 0;
    while ((m = LEGACY_TAG_RE.exec(text)) !== null) {
      const n = normalizeURL(m[1]);
      if (n) results.push({ raw: m[1], url: n, full: m[0] });
    }

    return results;
  }

  // ── Debounce ──────────────────────────────────────────────────────────────
  function debounce(fn, wait) {
    let t = null;
    return (...a) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; try { fn(...a); } catch (e) { console.error('[ytimg]', e); } }, wait);
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  PART A — COMPOSER SIDE
  //  Shows a live image preview strip below the comment composer.
  //  Auto-converts legacy [image=…] tags to PUA format on-the-fly.
  // ═════════════════════════════════════════════════════════════════════════

  function findEditableInComposer(container) {
    if (!container) return null;
    for (const sel of [
      '[contenteditable="true"]',
      '#contenteditable-root',
      'yt-formatted-string[contenteditable="true"]',
    ]) {
      const el = container.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  /** Replace legacy [image=…] occurrences with PUA format inside a contenteditable */
  function convertLegacyInEditable(editable) {
    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT, null, false);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(node => {
      const txt = node.nodeValue || '';
      if (!LEGACY_TAG_RE.test(txt)) return;
      LEGACY_TAG_RE.lastIndex = 0;
      node.nodeValue = txt.replace(LEGACY_TAG_RE, (_, raw) => encodePUA(raw));
    });
  }

  /** Refresh the preview strip for a given composer wrapper */
  function updateComposerPreview(composerEl) {
    const editable = findEditableInComposer(composerEl);
    if (!editable) return;

    const text = editable.innerText || editable.textContent || '';
    const images = extractImageURLs(text);

    // find/create preview wrapper
    let preview = composerEl.querySelector('.' + PREVIEW_CLASS);

    if (images.length === 0) {
      if (preview) preview.remove();
      const hint = composerEl.querySelector('.' + HINT_CLASS);
      if (hint) hint.remove();
      return;
    }

    if (!preview) {
      preview = document.createElement('div');
      preview.className = PREVIEW_CLASS;
      composerEl.appendChild(preview);
    }

    // ── hint line ──────────────────────────────────────────────────────────
    let hint = composerEl.querySelector('.' + HINT_CLASS);
    if (!hint) {
      hint = document.createElement('div');
      hint.className = HINT_CLASS;
      hint.textContent = 'Format: \uE001<url>\uE002 (PUA) · aliases: pcd yt gh mc · schemes: h:// hs://';
      composerEl.appendChild(hint);
    }

    // sync images — remove stale, add missing
    const currentSrcs = new Set(
      Array.from(preview.querySelectorAll('img.' + PREVIEW_IMG_CLASS)).map(i => i.src)
    );
    const newSrcs = images.map(i => i.url);

    // remove stale
    preview.querySelectorAll('img.' + PREVIEW_IMG_CLASS).forEach(img => {
      if (!newSrcs.includes(img.src)) img.remove();
    });
    preview.querySelectorAll('.ytimg-broken').forEach(d => {
      if (!d._ytimgSrc || !newSrcs.includes(d._ytimgSrc)) d.remove();
    });

    // add missing in order
    for (const { url } of images) {
      if (!currentSrcs.has(url)) {
        const img = document.createElement('img');
        img.className = PREVIEW_IMG_CLASS;
        img.loading = 'lazy';
        img.alt = '';
        img.src = url;
        img.addEventListener('error', () => {
          const box = document.createElement('div');
          box.className = 'ytimg-broken';
          box._ytimgSrc = url;
          box.textContent = '⚠ Preview failed';
          if (img.parentNode) img.parentNode.replaceChild(box, img);
        });
        preview.appendChild(img);
      }
    }
  }

  function attachComposer(composerEl) {
    if (!composerEl || composerEl.dataset.ytimgAttached === '1') return;
    composerEl.dataset.ytimgAttached = '1';

    const editable = findEditableInComposer(composerEl);
    if (!editable) return;

    const debouncedPreview  = debounce(() => updateComposerPreview(composerEl), 160);
    const debouncedConvert  = debounce(() => convertLegacyInEditable(editable), 400);

    function onInput() { debouncedConvert(); debouncedPreview(); }
    function onPaste() { setTimeout(() => { debouncedConvert(); debouncedPreview(); }, 60); }

    editable.addEventListener('input', onInput);
    editable.addEventListener('keyup', onInput);
    editable.addEventListener('paste', onPaste);

    // initial check
    setTimeout(() => updateComposerPreview(composerEl), 250);

    // cleanup when composer detaches
    const mo = new MutationObserver(() => {
      if (!document.body.contains(composerEl)) {
        editable.removeEventListener('input', onInput);
        editable.removeEventListener('keyup', onInput);
        editable.removeEventListener('paste', onPaste);
        mo.disconnect();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function scanForComposers() {
    const selectors = [
      'ytd-comment-simplebox-renderer',
      'ytd-commentbox #simplebox',
      'div#simplebox',
      'ytd-commentbox',
      '.comment-simplebox-renderer',
      '.yt-simplebox-renderer',
    ];
    const els = document.querySelectorAll(selectors.join(','));
    if (els && els.length) {
      els.forEach(attachComposer);
    } else {
      // fallback
      document.querySelectorAll('[contenteditable="true"]').forEach(e => {
        const w = e.closest('ytd-comment-simplebox-renderer, ytd-commentbox, div#simplebox') || e.parentElement;
        if (w) attachComposer(w);
      });
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  PART B — COMMENT VIEWER SIDE
  //  Parses PUA image tags inside posted comment text and renders <img>.
  // ═════════════════════════════════════════════════════════════════════════

  function processCommentElement(el) {
    if (!el) return;

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    let didWork = false;
    textNodes.forEach(node => {
      const text = node.nodeValue || '';

      PUA_TAG_RE.lastIndex = 0;
      LEGACY_TAG_RE.lastIndex = 0;
      const hasPUA    = PUA_TAG_RE.test(text);
      const hasLegacy = LEGACY_TAG_RE.test(text);
      if (!hasPUA && !hasLegacy) return;

      // Rebuild the combined regex pass
      const combinedRE = new RegExp(
        IMG_S + '([^' + IMG_E + '\\n]+)' + IMG_E + '|\\[image=([^\\]\\n]+)\\]',
        'g'
      );

      const frag = document.createDocumentFragment();
      let last = 0;
      let m;

      while ((m = combinedRE.exec(text)) !== null) {
        const before = text.slice(last, m.index);
        if (before) frag.appendChild(document.createTextNode(before));

        const rawUrl = (m[1] || m[2] || '').trim();
        const url    = normalizeURL(rawUrl);

        if (url) {
          try {
            const img = document.createElement('img');
            img.src = url;
            img.alt = '';
            img.className = COMMENT_IMG_CLASS;
            img.loading = 'lazy';
            img.addEventListener('error', () => { img.remove(); });
            frag.appendChild(img);
          } catch (_) {
            frag.appendChild(document.createTextNode(m[0]));
          }
        } else {
          frag.appendChild(document.createTextNode(m[0]));
        }
        last = combinedRE.lastIndex;
      }

      const trailing = text.slice(last);
      if (trailing) frag.appendChild(document.createTextNode(trailing));

      node.parentNode.replaceChild(frag, node);
      didWork = true;
    });

    if (didWork) el.dataset.ytimgProcessed = Date.now().toString();
  }

  function processAllComments() {
    document.querySelectorAll('#content-text').forEach(processCommentElement);
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  PAGE WATCHER — drives both parts
  // ═════════════════════════════════════════════════════════════════════════

  const debouncedComposers = debounce(scanForComposers, 280);
  const debouncedComments  = debounce(processAllComments, 460);

  const pageObserver = new MutationObserver(mutations => {
    let hasNodes = false, hasChars = false;
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length) { hasNodes = true; }
      if (m.type === 'characterData')           { hasChars = true; }
      if (hasNodes && hasChars) break;
    }
    if (hasNodes) { debouncedComposers(); debouncedComments(); }
    if (hasChars) { debouncedComments(); }
  });

  pageObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // SPA navigation
  window.addEventListener('yt-navigate-finish', () => {
    setTimeout(() => { scanForComposers(); processAllComments(); }, 700);
  });

  // Initial run
  setTimeout(() => { scanForComposers(); processAllComments(); }, 650);

  // Low-frequency safety net for late-loading comments
  setInterval(processAllComments, 12_000);

  // Debug hooks
  window.__ytimg = { scan: scanForComposers, process: processAllComments, encode: encodePUA, normalize: normalizeURL };
})();
