import { readdir, lstat, realpath } from "node:fs/promises";
import path from "node:path";

export const DIRECTORY = "/storage/emulated/0/Screenshots";
const SUFFIXES = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

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
  if (info.size > MAX_IMAGE_BYTES) throw new Error("Screenshot exceeds the 25 MiB safety limit.");
  checkAbort(signal);
  return { ...metadata(filename, info), path: file, age_seconds: Math.max(0, Math.round((Date.now() - info.mtimeMs) / 1000)) };
}
