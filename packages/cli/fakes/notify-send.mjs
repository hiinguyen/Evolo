// Stand-in for `notify-send` in end-to-end tests: appends each notification to $FAKE_NOTIFY_LOG as one JSON line.
import { appendFileSync } from "node:fs";

const [title, body] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
appendFileSync(process.env.FAKE_NOTIFY_LOG, `${JSON.stringify({ title, body })}\n`);
