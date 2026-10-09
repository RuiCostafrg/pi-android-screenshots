// Model-free integration test against the installed Pi runtime.
// Lists and reads the newest three screenshots locally; never prints image data.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

let sdk;
try {
  sdk = await import("@earendil-works/pi-coding-agent");
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi/agent");
  const version = (await readFile(path.join(agentDir, "install/current-version"), "utf8")).trim();
  if (!/^[\w.-]+$/.test(version)) throw new Error("Invalid managed Pi version.");
  sdk = await import(pathToFileURL(path.join(agentDir, "install/releases", version,
    "node_modules/@earendil-works/pi-coding-agent/dist/index.js")).href);
}
const { createAgentSession, SessionManager, DefaultResourceLoader,
  createCodemodeExtension, createToolSearchExtension, getAgentDir } = sdk;
let blockScreenshots = false;
const resourceLoader = new DefaultResourceLoader({
  cwd: process.cwd(), agentDir: getAgentDir(),
  extensionFactories: [
    createCodemodeExtension({ mode: "on" }), createToolSearchExtension(),
    (pi) => pi.on("tool_call", event => {
      if (blockScreenshots && event.toolName === "screenshots") {
        return { block: true, reason: "SMOKE_TEST_PERMISSION_DENIED" };
      }
    }),
  ],
});
await resourceLoader.reload();
const { session, extensionsResult } = await createAgentSession({ resourceLoader, sessionManager: SessionManager.inMemory() });
try {
  assert.deepEqual(extensionsResult.errors, []);
  await session.bindExtensions({ onError: error => { throw new Error(JSON.stringify(error)); } });
  assert.ok(session.getActiveToolNames().includes("screenshots"), "screenshots should be active");
  assert.ok(session.getCallableToolNames().includes("screenshots"), "screenshots should be callable");
  console.log("Fresh Pi session: screenshots active and callable; no extension errors.");
  // Search is intended to load inactive tools; remove the declaration first.
  session.setActiveToolsByName(session.getActiveToolNames().filter(name => name !== "screenshots"));
  const tools = session.agent.state.tools;
  const search = tools.find(t => t.name === "tool_search");
  const found = await search.execute("smoke-search", { query: "screenshots", limit: 3 });
  console.log("Search result:", JSON.stringify(found.content));
  assert.ok(found.content.some(b => b.type === "text" && b.text.includes("screenshots")), "tool search should find screenshots");
  console.log("Tool search: screenshots found.");
  const codemode = tools.find(t => t.name === "codemode");
  // Simulate an assistant-issued call in this disposable in-memory transcript.
  // Nested tool execution requires an issuing message; no model request is made.
  session.sessionManager.appendMessage({
    role: "assistant", content: [{ type: "toolCall", id: "smoke-read", name: "codemode", arguments: {} }],
    api: session.model.api, provider: session.model.provider, model: session.model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse", timestamp: Date.now(),
  });
  session.agent.state.messages = session.sessionManager.buildSessionContext().messages;
  const result = await codemode.execute("smoke-read", { code: `
    const listing = await tools.screenshots({action: "list", limit: 3});
    text({total: listing.total, selected: listing.screenshots.map(x => x.filename)});
    for (const item of listing.screenshots) {
      const screenshot = await tools.screenshots({action: "read", filename: item.filename});
      if (screenshot.type !== "image") throw new Error("Missing image result");
      image(screenshot);
    }
  ` });
  const images = result.content.filter(b => b.type === "image");
  for (const block of result.content) if (block.type === "text") console.log(block.text);
  assert.equal(images.length, 3, "expect three image attachments");
  assert.ok(images.every(b => b.data.length > 0));
  console.log("Codemode: three valid image attachments, via normal nested tool pipeline.");
  blockScreenshots = true;
  const blocked = await codemode.execute("smoke-blocked", { code: 'text(await tools.screenshots({action: "list"}));' });
  assert.ok(blocked.content.some(b => b.type === "text" && b.text.includes("SMOKE_TEST_PERMISSION_DENIED")), "permission hook should block access");
  console.log("Permission hooks: blocked screenshot access correctly.");
} finally {
  session.dispose();
}
