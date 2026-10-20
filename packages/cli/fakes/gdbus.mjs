// Stand-in for `gdbus` in end-to-end tests: answers the notification server's GetCapabilities like a desktop does,
// with "body-markup" while the file $FAKE_NOTIFY_LOG.markup exists. Any other call fails.
import { existsSync } from "node:fs";

if (!process.argv.includes("org.freedesktop.Notifications.GetCapabilities")) {
  process.stderr.write("fake gdbus: only GetCapabilities is supported\n");
  process.exit(1);
}
const capabilities = ["actions", "body", ...(existsSync(`${process.env.FAKE_NOTIFY_LOG}.markup`) ? ["body-markup"] : [])];
process.stdout.write(`([${capabilities.map((name) => `'${name}'`).join(", ")}],)\n`);
