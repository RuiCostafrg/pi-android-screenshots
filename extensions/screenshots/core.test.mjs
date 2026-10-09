import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, symlink, utimes, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listScreenshots, selectScreenshot } from "./core.mjs";

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
