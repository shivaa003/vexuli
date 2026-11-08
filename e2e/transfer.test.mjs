import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { chromium } from "playwright";

test("two real browser clients exchange text and a file over WebRTC", async (t) => {
  const port = randomInt(49_000, 61_000);
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["server/index.mjs"], {
    env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  server.stdout.on("data", (chunk) => { logs += chunk.toString(); });
  server.stderr.on("data", (chunk) => { logs += chunk.toString(); });
  t.after(() => server.kill("SIGTERM"));

  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.ok(ready, `server did not start: ${logs}`);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const senderContext = await browser.newContext({ acceptDownloads: true });
  const receiverContext = await browser.newContext({ acceptDownloads: true });
  const disableNativePicker = () => {
    // Exercise the Safari/Firefox download fallback instead of the native save dialog.
    Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true });
  };
  await senderContext.addInitScript(disableNativePicker);
  await receiverContext.addInitScript(disableNativePicker);
  const sender = await senderContext.newPage();
  const receiver = await receiverContext.newPage();
  const errors = [];
  sender.on("pageerror", (error) => errors.push(`sender: ${error.message}`));
  receiver.on("pageerror", (error) => errors.push(`receiver: ${error.message}`));
  sender.setDefaultTimeout(15_000);
  receiver.setDefaultTimeout(15_000);

  await Promise.all([sender.goto(base), receiver.goto(base)]);
  await sender.getByRole("button", { name: /Generate a 4-digit code/ }).click();
  const room = sender.locator('[aria-label^="Your room code is"]');
  await room.waitFor();
  const code = (await room.getAttribute("aria-label")).replace(/\D/g, "");
  assert.match(code, /^\d{4}$/);

  await receiver.getByRole("tab", { name: "Join with code" }).click();
  for (let i = 0; i < 4; i++) {
    await receiver.getByRole("textbox", { name: `Code digit ${i + 1}` }).fill(code[i]);
  }
  await receiver.getByRole("button", { name: "Request to connect" }).click();
  await sender.getByText("Someone wants to join").waitFor();
  const senderPhrase = await sender.locator("text=Pairing phrase").locator("..").locator("p").last().textContent();
  const receiverPhrase = await receiver.locator("text=Pairing phrase").locator("..").locator("p").last().textContent();
  assert.equal(senderPhrase, receiverPhrase);
  await sender.getByRole("button", { name: "Approve device" }).click();
  try {
    await Promise.all([
      sender.getByText("Secure channel open").waitFor({ timeout: 35_000 }),
      receiver.getByText("Secure channel open").waitFor({ timeout: 35_000 }),
    ]);
  } catch (error) {
    console.error("SENDER STATE:", await sender.locator("#transfer").innerText());
    console.error("RECEIVER STATE:", await receiver.locator("#transfer").innerText());
    console.error("BROWSER ERRORS:", errors, "SERVER:", logs);
    throw error;
  }

  await sender.getByRole("tab", { name: "Text" }).click();
  await receiver.getByRole("tab", { name: "Text" }).click();
  await sender.getByLabel("Send plain text").fill("A real message sent over WebRTC, not a preview.");
  await sender.getByRole("button", { name: "Send text" }).click();
  await receiver.getByText("A real message sent over WebRTC, not a preview.").waitFor();
  await receiver.getByLabel("Send plain text").fill("Acknowledged from device two.");
  await receiver.getByRole("button", { name: "Send text" }).click();
  await sender.getByText("Acknowledged from device two.").waitFor();

  await sender.getByRole("tab", { name: /Files/ }).click();
  await receiver.getByRole("tab", { name: /Files/ }).click();
  await sender.getByLabel("Choose files to send").setInputFiles({
    name: "hello-vexuli.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Verified file sent directly from the other browser.\n"),
  });
  await receiver.getByRole("region", { name: "Incoming file request" }).waitFor();
  await receiver.getByRole("button", { name: /Accept & save/ }).click();
  const save = receiver.getByRole("link", { name: "Download hello-vexuli.txt" });
  await save.waitFor({ timeout: 35_000 });
  const downloadEvent = receiver.waitForEvent("download");
  await save.click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), "hello-vexuli.txt");
  const bytes = await readFile(await download.path());
  assert.equal(bytes.toString(), "Verified file sent directly from the other browser.\n");

  const large = Buffer.alloc(2 * 1024 * 1024 + 57);
  for (let i = 0; i < large.length; i++) large[i] = i % 251;
  await receiver.getByLabel("Choose files to send").setInputFiles({
    name: "round-trip.bin",
    mimeType: "application/octet-stream",
    buffer: large,
  });
  await sender.getByRole("region", { name: "Incoming file request" }).waitFor();
  await sender.getByRole("button", { name: /Accept & save/ }).click();
  const reverseSave = sender.getByRole("link", { name: "Download round-trip.bin" });
  await reverseSave.waitFor({ timeout: 45_000 });
  const reverseEvent = sender.waitForEvent("download");
  await reverseSave.click();
  const reverseDownload = await reverseEvent;
  const roundTrip = await readFile(await reverseDownload.path());
  assert.deepEqual(roundTrip, large, "chunked transfers must preserve every byte");

  await sender.evaluate(() => {
    window.receivedChunks = [];
    window.writerClosed = false;
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => ({
        createWritable: async () => ({
          write: async (chunk) => { window.receivedChunks.push(...new Uint8Array(chunk)); },
          close: async () => { window.writerClosed = true; },
          abort: async () => {},
        }),
      }),
    });
  });
  const written = Buffer.alloc(48 * 1024 + 5, 123);
  await receiver.getByLabel("Choose files to send").setInputFiles({
    name: "native-save.bin",
    mimeType: "application/octet-stream",
    buffer: written,
  });
  await sender.getByRole("region", { name: "Incoming file request" }).waitFor();
  await sender.getByRole("button", { name: /Accept & save/ }).click();
  await sender.getByText("Saved on this device").waitFor();
  const saved = await sender.evaluate(() => ({ closed: window.writerClosed, bytes: window.receivedChunks }));
  assert.equal(saved.closed, true, "the file stream must be closed after the last chunk");
  assert.deepEqual(Buffer.from(saved.bytes), written, "stream-to-disk path must preserve each byte");

  await sender.getByLabel("Choose files to send").setInputFiles({
    name: "not-accepted.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Do not deliver this one"),
  });
  await receiver.getByRole("region", { name: "Incoming file request" }).waitFor();
  await receiver.getByRole("button", { name: "Decline" }).click();
  await sender.getByText(/Declined/).first().waitFor();
  assert.equal(await receiver.getByRole("link", { name: "Download not-accepted.txt" }).count(), 0);

  await sender.getByRole("button", { name: "End session" }).click();
  await receiver.getByText("Session ended.", { exact: false }).waitFor();

  await receiver.setViewportSize({ width: 390, height: 844 });
  const overflows = await receiver.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  assert.equal(overflows, false, "the layout should not overflow on phones");
  assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
});