import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Only the HTML parsing is tested; resolveFavicon needs a real session.
const require = createRequire(import.meta.url);
const { iconCandidates } = require("../../electron/favicon.cjs");

describe("favicon candidates", () => {
  const page = "https://mail.example.com/mail/u/0/";

  it("resolves relative hrefs and prefers icons sized near 32 px or SVG", () => {
    const html = `<head>
      <link rel="apple-touch-icon" href="/apple.png">
      <link rel="icon" sizes="192x192" href="/big.png">
      <link rel="shortcut icon" href="favicon-32.png" sizes="32x32">
      <link rel="stylesheet" href="/style.css">
    </head>`;
    expect(iconCandidates(html, page)).toEqual([
      "https://mail.example.com/mail/u/0/favicon-32.png",
      "https://mail.example.com/big.png",
      "https://mail.example.com/apple.png",
    ]);
  });

  it("accepts single quotes, unquoted values, &amp; and data images, and ignores other schemes", () => {
    const html = `<link rel='icon' type='image/svg+xml' href='/i.svg?a=1&amp;b=2'><link rel=icon href=data:image/png;base64,AA><link rel="icon" href="javascript:alert(1)">`;
    expect(iconCandidates(html, page)).toEqual(["https://mail.example.com/i.svg?a=1&b=2", "data:image/png;base64,AA"]);
  });

  it("returns nothing for pages without icons", () => {
    expect(iconCandidates("<html><head><title>x</title></head></html>", page)).toEqual([]);
  });
});
