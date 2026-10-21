// Stand-in for `xdg-open` in end-to-end tests, so no browser opens: appends the arguments of each call to
// $FAKE_OPEN_LOG as one JSON line.
import { appendFileSync } from "node:fs";

appendFileSync(process.env.FAKE_OPEN_LOG, `${JSON.stringify(process.argv.slice(2))}\n`);
