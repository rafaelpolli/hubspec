#!/usr/bin/env node
// A stand-in for the gh CLI in tests: records every call and keeps PRs in $FAKE_GH_DIR/prs.json.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const dir = process.env.FAKE_GH_DIR;
const args = process.argv.slice(2);
appendFileSync(join(dir, "calls.log"), `${JSON.stringify({ cwd: basename(process.cwd()), args })}\n`);
const store = join(dir, "prs.json");
const prs = existsSync(store) ? JSON.parse(readFileSync(store, "utf8")) : [];
const opt = (name) => args[args.indexOf(name) + 1];

if (args[0] === "config" && args[1] === "get" && args[2] === "git_protocol") {
  process.stdout.write(`${process.env.FAKE_GH_PROTOCOL ?? "https"}\n`);
} else if (args[0] === "pr" && args[1] === "list") {
  const repo = basename(process.cwd());
  const found = prs.filter((p) => p.repo === repo && p.head === opt("--head")).map(({ url, number }) => ({ url, number }));
  process.stdout.write(JSON.stringify(found.slice(0, 1)));
} else if (args[0] === "pr" && args[1] === "create") {
  const repo = basename(process.cwd());
  const number = prs.length + 1;
  const url = `https://github.com/acme/${repo}/pull/${number}`;
  prs.push({ repo, number, url, base: opt("--base"), head: opt("--head"), title: opt("--title"), body: opt("--body") });
  writeFileSync(store, JSON.stringify(prs, null, 2));
  process.stdout.write(`Creating pull request\n${url}\n`);
} else if (args[0] === "pr" && args[1] === "edit") {
  const pr = prs.find((p) => p.url === args[2]);
  if (!pr) {
    process.stderr.write(`no pull request found for ${args[2]}\n`);
    process.exit(1);
  }
  pr.body = opt("--body");
  writeFileSync(store, JSON.stringify(prs, null, 2));
} else {
  process.stderr.write(`fake gh: unsupported ${args.join(" ")}\n`);
  process.exit(1);
}
