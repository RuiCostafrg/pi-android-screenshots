import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, symlink, utimes, rm, truncate } from "node:fs/promises";
import { deflateSync, crc32 } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { listScreenshots, selectScreenshot, readScreenshot } from "./core.mjs";

function testPng() {
  function chunk(type, data) {
    const tag = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc32(Buffer.concat([tag, data])));
    return Buffer.concat([length, tag, data, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(8, 0); header.writeUInt32BE(8, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc(8 * 25))), chunk("IEND", Buffer.alloc(0))]);
}

async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pi-screenshots-"));
  try {
    await writeFile(path.join(directory, "old.png"), "image");
    await writeFile(path.join(directory, "a.png"), "image");
    await writeFile(path.join(directory, "b.JPG"), "image");
    await writeFile(path.join(directory, "empty.png"), "");
    await writeFile(path.join(directory, "notes.txt"), "not an image");
    await mkdir(path.join(directory, "folder.png"));
    await symlink(path.join(directory, "old.png"), path.join(directory, "link.png"));
    await utimes(path.join(directory, "old.png"), 100, 100);
    await utimes(path.join(directory, "a.png"), 200, 200);
    await utimes(path.join(directory, "b.JPG"), 200, 200);
    await run(directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("list filters file types, empty files, folders and links; deterministic timestamp ties", () => fixture(async directory => {
  const listing = await listScreenshots({}, directory);
  assert.deepEqual(listing.screenshots.map(x => x.filename), ["a.png", "b.JPG", "old.png"]);
  assert.equal(listing.total, 3);
  assert.equal(listing.next_offset, null);
  assert.ok(listing.screenshots.every(x => !Object.hasOwn(x, "data")));
}));
test("pagination and case-insensitive filename filtering", () => fixture(async directory => {
  const first = await listScreenshots({ limit: 1 }, directory);
  assert.equal(first.next_offset, 1);
  assert.equal((await listScreenshots({ limit: 1, offset: 1 }, directory)).screenshots[0].filename, "b.JPG");
  assert.equal((await listScreenshots({ contains: "OLD" }, directory)).screenshots[0].filename, "old.png");
  assert.equal((await listScreenshots({ offset: 10 }, directory)).screenshots.length, 0);
}));
test("select latest or a stable older filename", () => fixture(async directory => {
  assert.equal((await selectScreenshot(undefined, directory)).filename, "a.png");
  assert.equal((await selectScreenshot("old.png", directory)).filename, "old.png");
  await writeFile(path.join(directory, "new.png"), "image");
  assert.equal((await selectScreenshot(undefined, directory)).filename, "new.png");
  assert.equal((await selectScreenshot("old.png", directory)).filename, "old.png");
}));
test("reject traversal, paths, links, empty images and invalid limits", () => fixture(async directory => {
  for (const filename of ["../old.png", "/tmp/old.png", "a\\old.png", "notes.txt", "link.png", "empty.png", "folder.png"]) {
    await assert.rejects(selectScreenshot(filename, directory));
  }
  for (const options of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { offset: -1 }]) {
    await assert.rejects(listScreenshots(options, directory));
  }
}));
test("empty folders, missing files and cancellation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pi-screenshots-empty-"));
  try {
    assert.equal((await listScreenshots({}, directory)).total, 0);
    await assert.rejects(selectScreenshot(undefined, directory), /No saved screenshots/);
    await assert.rejects(selectScreenshot("missing.png", directory), { code: "ENOENT" });
    const controller = new AbortController(); controller.abort();
    await assert.rejects(listScreenshots({}, directory, controller.signal), /cancelled/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("returns original image bytes without a resizer or native read tool", () => fixture(async directory => {
  const png = testPng();
  await writeFile(path.join(directory, "valid.png"), png);
  const result = await readScreenshot("valid.png", directory);
  assert.equal(result.image.type, "image");
  assert.equal(result.image.mimeType, "image/png");
  assert.deepEqual(Buffer.from(result.image.data, "base64"), png);
  assert.ok(result.image.note.includes("valid.png"));
}));
test("detects format by bytes rather than filename", () => fixture(async directory => {
  await writeFile(path.join(directory, "wrong-extension.jpg"), testPng());
  assert.equal((await readScreenshot("wrong-extension.jpg", directory)).image.mimeType, "image/png");
}));
test("rejects invalid image bytes, oversized files, symlinks and cancelled reads", () => fixture(async directory => {
  await assert.rejects(readScreenshot("old.png", directory), /not a supported/);
  await assert.rejects(readScreenshot("link.png", directory), /regular file/);
  await writeFile(path.join(directory, "huge.png"), testPng());
  await truncate(path.join(directory, "huge.png"), 5 * 1024 * 1024 + 1);
  await assert.rejects(readScreenshot("huge.png", directory), /5 MiB/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readScreenshot("old.png", directory, controller.signal), /cancelled/);
}));
