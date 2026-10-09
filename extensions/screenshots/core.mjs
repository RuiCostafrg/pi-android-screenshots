import { readdir, lstat, realpath, open } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

export const DIRECTORY = "/storage/emulated/0/Screenshots";
const SUFFIXES = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function checkAbort(signal) {
  if (signal?.aborted) throw new Error("Screenshot operation cancelled.");
}

export function validateFilename(filename) {
  if (typeof filename !== "string" || !filename || filename === "." || filename === ".." ||
      /[\\/\x00-\x1f\x7f]/.test(filename) || !SUFFIXES.has(path.extname(filename).toLowerCase())) {
    throw new Error("Use an exact screenshot filename from screenshots list, not a path.");
  }
}

function metadata(filename, info) {
  return { filename, modified_at: info.mtime.toISOString(), bytes: info.size };
}

// Only immediate regular nonempty image files; no recursive scans or image reads.
export async function scan(directory = DIRECTORY, signal) {
  checkAbort(signal);
  const entries = await readdir(directory, { withFileTypes: true });
  const images = [];
  for (const entry of entries) {
    checkAbort(signal);
    if (!entry.isFile() || !SUFFIXES.has(path.extname(entry.name).toLowerCase())) continue;
    try {
      validateFilename(entry.name);
      const info = await lstat(path.join(directory, entry.name));
      if (info.isFile() && info.size > 0) images.push({ ...metadata(entry.name, info), mtime: info.mtimeMs });
    } catch (error) {
      if (error.code === "ENOENT") continue; // Deleted during scan.
      throw error;
    }
  }
  // Explicit lexical tie-break makes equal timestamps deterministic across locales.
  images.sort((a, b) => b.mtime - a.mtime || (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
  return images.map(({ mtime, ...item }) => item);
}

export async function listScreenshots({ limit = 10, offset = 0, contains } = {}, directory = DIRECTORY, signal) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("limit must be an integer from 1 to 50.");
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("offset must be a nonnegative integer.");
  if (contains !== undefined && (typeof contains !== "string" || contains.length > 200)) throw new Error("contains must be a string of at most 200 characters.");
  let items = await scan(directory, signal);
  if (contains) items = items.filter(item => item.filename.toLowerCase().includes(contains.toLowerCase()));
  return {
    directory, order: "modification time descending, filename ascending on ties",
    total: items.length, offset,
    next_offset: offset + limit < items.length ? offset + limit : null,
    screenshots: items.slice(offset, offset + limit),
  };
}

export async function selectScreenshot(filename, directory = DIRECTORY, signal) {
  checkAbort(signal);
  if (filename !== undefined) validateFilename(filename);
  else {
    const items = await scan(directory, signal);
    if (!items.length) throw new Error(`No saved screenshots found in ${directory}. Take a screenshot and try again.`);
    filename = items[0].filename;
  }
  const file = path.join(directory, filename);
  const info = await lstat(file);
  if (!info.isFile() || info.size === 0) throw new Error("Screenshot must be a nonempty regular file, not a symlink or folder.");
  const [root, resolved] = await Promise.all([realpath(directory), realpath(file)]);
  if (path.dirname(resolved) !== root) throw new Error("Screenshot is outside the allowed folder.");
  if (info.size > MAX_IMAGE_BYTES) throw new Error("Screenshot exceeds the 5 MiB inline-image safety limit.");
  checkAbort(signal);
  return { ...metadata(filename, info), path: file, age_seconds: Math.max(0, Math.round((Date.now() - info.mtimeMs) / 1000)) };
}

function detectMime(bytes) {
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.toString("ascii", 12, 16) === "IHDR") return "image/png";
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 &&
      bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) return "image/jpeg";
  if (bytes.length >= 13 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "image/gif";
  if (bytes.length >= 20 && bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw new Error("File is not a supported PNG, JPEG, GIF or WebP image (or is incomplete).");
}

// Return original encoded bytes: no WASM/native resizer or nested read tool.
// The screenshots tool's own validation and permission hooks still apply.
export async function readScreenshot(filename, directory = DIRECTORY, signal) {
  const selected = await selectScreenshot(filename, directory, signal);
  const handle = await open(selected.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    checkAbort(signal);
    const info = await handle.stat();
    if (!info.isFile() || info.size === 0 || info.size > MAX_IMAGE_BYTES) {
      throw new Error("Screenshot must be a nonempty regular image no larger than 5 MiB.");
    }
    // Bounded allocation/read, including one extra byte to detect file growth.
    const buffer = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < buffer.length) {
      checkAbort(signal);
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    if (length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs) {
      throw new Error("Screenshot changed while reading. Try again after saving finishes.");
    }
    checkAbort(signal);
    const bytes = buffer.subarray(0, length);
    const mimeType = detectMime(bytes);
    const details = { ...selected, ...metadata(selected.filename, info), age_seconds: Math.max(0, Math.round((Date.now() - info.mtimeMs) / 1000)) };
    const note = `${JSON.stringify(details)}\nSaved screenshot, not a live view. Original image; no automatic resizing.`;
    return { details, image: { type: "image", data: bytes.toString("base64"), mimeType, note } };
  } finally {
    await handle.close();
  }
}
