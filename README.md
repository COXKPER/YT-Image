# YouTube Image Comments

**Post and view images in YouTube comments — no external service required.**

This is a unified Chrome extension that covers **both sides** of image comments:

| Side | What it does |
|------|-------------|
| **Composer** | Live image preview while you type; auto-converts legacy syntax |
| **Viewer** | Renders image tags in posted comments as real `<img>` elements |

Previously these were two separate extensions. This release merges them into one.

---

## 📸 Screenshots

![Composer preview](https://meow.fourvo.id/screen2.jpg)
![Comment rendering](https://meow.fourvo.id/screen.jpg)

---

## ⚙️ Installation

1. Download or clone this repository and **unzip** if necessary.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer Mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the extension folder.
5. Navigate to any YouTube video with a comment section to test.

> Firefox / Edge: same steps via `about:debugging` or the Edge Extensions page.

---

## ✍️ Tag Format

Images are embedded in comments using **PUA Unicode delimiters**:

```
<U+E001><url><U+E002>
```

`U+E001` and `U+E002` are Private Use Area characters — they are invisible in plain text but detected and rendered by this extension. Other users without the extension see only the raw URL (no broken markup).

### Supported URL shorthands

| Shorthand | Expands to |
|-----------|-----------|
| `h://…`   | `http://…` |
| `hs://…`  | `https://…` |
| `pcd/…`   | `cdn.fourvo.id/…` |
| `yt/…`    | `i.ytimg.com/…` |
| `gh/…`    | `raw.githubusercontent.com/…` |
| `mc/…`    | `textures.minecraft.net/…` |

### TLD aliases (inside any URL)

| Write | Gets expanded to |
|-------|-----------------|
| `.dic` | `.id` |
| `.cv`  | `.com` |
| `.mcd` | `.me` |

### Full example

To embed `https://meow.fourvo.id/image.png` using shorthands:

```
[U+E001]hs://meow.fourvo.dic/image.png[U+E002]
```

Which expands to `https://meow.fourvo.id/image.png`.

You can also type the old bracket format in the **composer** — it will be auto-converted to PUA format as you type:

```
[image=hs://meow.fourvo.dic/image.png]
```

> The bracket `[image=…]` format is still **rendered** in posted comments for backwards compatibility.

---

## 🧩 How It Works

### Composer (before posting)

1. The extension monitors the YouTube comment input box.
2. As you type a PUA image tag (or old `[image=…]` tag), a live preview strip appears below the composer.
3. Old `[image=…]` tags are silently converted to PUA format in the editor.
4. A format hint line shows the supported syntax.

### Viewer (posted comments)

1. The extension scans `#content-text` nodes inside all visible comments.
2. PUA-delimited URLs (and legacy bracket tags) are replaced with `<img>` elements.
3. The observer watches for new comments loaded dynamically (infinite scroll, reply expansion).
4. A 12-second safety sweep catches any comments that slip through.

---

## 🔧 Customizing Aliases

Open `content.js` and edit the `aliasMap` object near the top:

```js
const aliasMap = {
  pcd: 'cdn.fourvo.id',
  yt:  'i.ytimg.com',
  gh:  'raw.githubusercontent.com',
  mc:  'textures.minecraft.net',
  // add your own:
  // mycdn: 'files.example.com',
};
```

---

## 🐛 Known Limitations

- YouTube restricts arbitrary HTML injection; the extension uses safe DOM text-node replacement.
- Chrome/YouTube updates may break composer attachment selectors — open an issue if the preview stops showing.
- PUA characters may be stripped by YouTube in a future update (monitor if images stop rendering for viewers).
- Images are fetched client-side; hosts must allow cross-origin requests (or at least not block hotlinking).

---

## 🛠 Debug

Open the browser console on any YouTube page. A global `__ytimg` object is exposed:

```js
__ytimg.scan()       // re-scan for composer boxes
__ytimg.process()    // re-process all visible comments
__ytimg.encode(url)  // wrap a URL in PUA delimiters → copy/paste into a comment
__ytimg.normalize(u) // test URL normalization
```

---

## 📄 License

APACHE — see `LICENSE`.
