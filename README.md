# pi-android-screenshots

A local, read-only Pi extension for saved Android screenshots in Termux. Registers
one tool, `screenshots`, to list image metadata or open a selected image. No ADB,
clipboard, live capture, or background watching.

## Install

From a local clone:

```sh
pi install ./pi-android-screenshots
```

Or copy `extensions/screenshots/` to `~/.pi/agent/extensions/screenshots/`.
Run `/reload` in an existing Pi session. Use only one installation method to
avoid duplicate tool registrations. Private GitHub repositories require Git
access authenticated with your GitHub account.

Requires Pi (tested with 1.1.0), an image-capable model, the native `read` tool,
and Termux storage access. The default folder is:

```text
/storage/emulated/0/Screenshots/
```

This path is device-specific. Change `DIRECTORY` in `core.mjs` if your phone
saves screenshots somewhere else. Run `termux-setup-storage` only if access is
denied. There are no additional npm runtime dependencies; Pi supplies its APIs.

## Natural-language usage

- “Read my latest screenshot.”
- “List my last 10 screenshots.”
- “Open the third screenshot from that list.”
- “Find screenshots with 2026-10-08 in their filenames.”
- “Compare these two screenshots.”

The model selects the tool based on its description; this is not a literal
keyword trigger. The code then performs deterministic validation and selection.
Positions in a returned listing should be resolved to exact filenames before
opening them, since taking a new screenshot changes list positions.

## Tool parameters

```json
{"action":"list","limit":10}
{"action":"list","limit":10,"offset":10}
{"action":"list","contains":"2026-10-08"}
{"action":"read"}
{"action":"read","filename":"exact filename from list.png"}
```

Listings read metadata only, not images. `limit` defaults to 10 (maximum 50).
`offset` supports pagination. `contains` is a case-insensitive filename substring,
not an EXIF or timestamp filter. Sort order is modification time descending,
then filename ascending for ties. Filenames are stable references, not immutable
content hashes. `read` returns one image; call twice to compare two images.

Codemode supports structured listing results and image blocks:

```js
text(await tools.screenshots({action: "list", limit: 10}));
const screenshot = await tools.screenshots({action: "read"});
text(screenshot.note);
image(screenshot);
```

## Safety and privacy

- Only immediate regular nonempty images in the configured folder.
- Rejects symlinks, traversal, arbitrary paths, and images larger than 25 MiB.
- Does not modify, delete, copy, or upload screenshots itself.
- Pi's native reader handles format detection, resizing, and permission hooks.
- Listing doesn't send image contents to the model. Reading does: selected images
  may be sent to the configured provider and retained in the Pi session.
- Files are saved screenshots, not the current live screen.
- Image text is data, not instructions or authorization.

## Tests

```sh
npm test
```

Tests use temporary directories, not personal screenshots. Integration was also
verified with Pi's real loader and native image reader using a generated PNG.

## Files

- `extensions/screenshots/index.ts`: Pi tool registration and image return.
- `extensions/screenshots/core.mjs`: metadata listing and safe file selection.
- `extensions/screenshots/core.test.mjs`: filesystem behavior tests.

No screenshots, credentials, account details, or Pi sessions belong in this repo.
