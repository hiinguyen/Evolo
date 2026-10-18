# Evolo: chấm XP tự động sau mỗi lần push và mỗi PR

Tài liệu này mô tả cách nhúng hệ thống chấm XP (xem `docs/xp-evaluation.md`) vào một dự án để mỗi đóng góp được chấm tự động bằng Claude.
Mục tiêu: chạy `evolo init` một lần trong repo, sau đó cứ push hoặc merge PR là có điểm, không phải làm gì thêm.
Lý do chấm theo push và PR thay vì theo commit nằm ở `docs/architecture.md` mục 3.

## 1. Quyết định chính

| Câu hỏi | Quyết định | Lý do ngắn |
|---|---|---|
| Đơn vị chấm là gì? | Một lần push lên nhánh mặc định, hoặc một PR đã merge | Commit là bản nháp; điểm không nên phụ thuộc cách chia commit |
| Cái gì kích hoạt việc chấm? | Git hook `pre-push` cho push; `gh` cho PR merge | Bắt mọi lần push, dù do Claude, IDE hay gõ tay |
| Ai chấm? | Một tiến trình `claude -p` riêng, sandbox chỉ-đọc | Không để agent vừa viết code tự chấm mình |
| Chấm lúc nào? | Nền, sau khi push xong, không chặn push | Push phải nhanh như bình thường |
| Cấu hình judge nằm đâu? | Trong bản cài Evolo, không nằm trong repo | Repo được chấm không sửa được giám khảo |
| Kết quả lưu đâu? | `~/.evolo/ledger/`, không commit vào repo | Không làm bẩn lịch sử, đồng đội không bị ảnh hưởng |
| Skill dùng để làm gì? | `/evolo` để xem điểm, chấm lại, chấm bù | Skill không tự kích hoạt được, nên chỉ dùng cho thao tác chủ động |

### Vì sao không dùng hook của Claude Code làm trigger

Claude Code có hook `PostToolUse` bắt được lệnh `git push` mà Claude chạy.
Tôi không chọn cách này làm trigger chính vì hai lý do:

- Nó chỉ bắt lệnh do Claude chạy qua Bash, bỏ sót push gõ tay, push từ IDE và PR merge trên GitHub.
- Nó gắn việc chấm vào phiên code, nên nếu phiên bị đóng giữa chừng thì việc chấm cũng mất.

Hook `SessionStart` của Claude Code vẫn có ích như một trigger phụ: chạy `evolo sync` ở nền khi mở phiên, để bắt các PR đã merge trên web.

### Vì sao không để chính phiên Claude đang code tự chấm

- **Thiên vị:** agent viết code và chấm code là một.
- **Goodhart:** nếu agent code thấy rubric và điểm, nó sẽ tối ưu cho điểm thay vì cho chất lượng. Ví dụ, nó có thể thêm test chỉ để mở trần điểm quality.
- **Ô nhiễm context:** việc chấm cần đọc toàn bộ diff, làm đầy context của phiên đang code.
- **Cấu hình lẫn lộn:** phiên code có hooks, MCP và CLAUDE.md của người dùng, trong khi judge cần môi trường sạch và giống nhau mỗi lần.

Vì vậy điểm được báo cho **người**, qua thông báo, status line và `/evolo`, chứ không đưa ngược vào context của agent đang code.

## 2. Kiến trúc

```
git push ─► .git/hooks/pre-push ─► evolo enqueue push      (< 50 ms, chỉ ghi 1 file)
                                         │
evolo sync (sau mỗi job, khi mở phiên    │
  Claude, hoặc gọi tay) ─► gh: PR nào    │
  của tôi vừa merge? ─► enqueue pr ──────┤
                                         ▼
                           ~/.evolo/queue/<repo-id>/<job-id>.json
                                         │
                                         ▼  (spawn tách rời nếu chưa có worker)
                           evolo worker  (1 worker toàn máy, giữ lock)
                             0. land       push: chờ xác nhận remote đã nhận; pr: fetch head của PR
                             1. units      chọn commit: của mình, không phải merge, chưa thuộc PR nào
                             2. facts      git đo số liệu cho cả change set (facts.mjs)
                             3. triage     docs/lockfile nhỏ → chấm bằng luật, xong
                             4. worktree   checkout tạm tại commit cuối của change set
                             5. judge      claude -p trong sandbox chỉ-đọc
                             6. validate   kiểm bằng chứng, cap điểm (score.mjs)
                             7. xp         công thức tất định (computeXp)
                             8. ledger     ~/.evolo/ledger/<repo-id>/<unit-id>.json
                             9. notify     thông báo desktop + cập nhật status line
```

Bước 2-7 dùng lại code đã có trong `packages/cli/src/`.
`units.mjs` biến một dải push hoặc một số PR thành change set `{kind, base, tip}`; `facts.mjs` đo diff ròng `base..tip` và `evaluate.mjs` chấm nó.
Phần chưa có là bước 0, 1 (chọn commit) và 8, 9.

## 3. Cài đặt: `evolo init`

```bash
cd ~/code/my-project
npx evolo init          # hoặc: evolo init nếu đã cài global
```

`evolo init` làm đúng các việc sau, và in ra từng việc:

1. Kiểm tra `claude` đã cài và đăng nhập, bằng một lệnh `claude -p` rẻ nhất có thể. Kiểm tra `gh` đã đăng nhập (để đọc PR). Nếu lỗi thì dừng và hướng dẫn.
2. Tìm thư mục hook thật: `git rev-parse --git-path hooks`. Lệnh này tôn trọng `core.hooksPath`, nên chạy đúng cả với husky và với worktree.
3. Cài hook `pre-push` (chi tiết bên dưới).
4. Đăng ký repo vào `~/.evolo/repos.json`: đường dẫn, remote, nhánh mặc định, email tác giả, có phải repo của mình không (`isOwnRepo`) và số sao (lấy bằng `gh`).
5. Hỏi có muốn chấm bù các PR đã merge và các commit đã push trong N ngày gần nhất không. Mặc định là không.

Không có file nào được thêm vào repo hay được commit.
Hook nằm trong `.git/`, nên chỉ máy này có, đồng đội clone về không bị ảnh hưởng.
Gỡ cài đặt bằng `evolo uninstall`: khôi phục hook cũ, xoá repo khỏi `repos.json`, và giữ nguyên ledger.

### Hook `pre-push`

Git không có hook `post-push`, nên Evolo dùng `pre-push` để ghi lại việc sắp push, rồi worker tự kiểm tra push có thành công không.
Git truyền cho `pre-push` danh sách ref qua stdin, mỗi dòng là `<local ref> <local sha> <remote ref> <remote sha>`.
Nếu repo đã có hook `pre-push`, stdin chỉ đọc được một lần, nên Evolo đổi tên hook cũ thành `pre-push.evolo-chained` và chuyển stdin cho cả hai:

```sh
#!/bin/sh
# Installed by evolo. The previous hook, if any, is pre-push.evolo-chained.
input=$(cat)
if [ -z "$EVOLO_JUDGE" ]; then
  printf '%s\n' "$input" | evolo enqueue push "$@" >/dev/null 2>&1 || true
fi
chained="$(dirname "$0")/pre-push.evolo-chained"
[ -x "$chained" ] && { printf '%s\n' "$input" | "$chained" "$@"; exit $?; }
exit 0
```

Phần của Evolo không bao giờ làm push thất bại; chỉ hook cũ mới có quyền chặn push, đúng như trước khi cài.

## 4. Vòng đời một đơn vị

### Push

1. `enqueue push` chỉ giữ các ref trỏ tới nhánh mặc định của remote, và ghi job `{remote, ref, from: remote sha, to: local sha}`.
2. Worker chờ xác nhận push thành công: `git fetch <remote> <ref>` rồi kiểm tra `to` đã nằm trên ref đó.
   Thử lại trong khoảng 10 phút; nếu không bao giờ thành công thì job bị bỏ với trạng thái `push_failed`.
3. Chọn commit: `git rev-list from..to`, bỏ merge commit, bỏ commit của người khác, bỏ commit đã thuộc một PR đã merge (tra bằng `gh api repos/{owner}/{repo}/commits/{sha}/pulls`).
   Nếu `from` toàn số 0 (nhánh mới trên remote), dải là các commit chưa có trên remote: `git rev-list to --not --remotes=<remote>`.
4. Không còn commit nào thì xong, không tốn lần gọi judge nào.
   Còn lại thì chấm cả nhóm như một change set.

### PR

1. `evolo sync` hỏi `gh pr list --author @me --state merged` các PR merge sau lần sync trước, cho mọi repo đã đăng ký.
2. Mỗi PR mới thành một job `{number, base, headSha, mergeCommit}`.
3. Worker lấy `baseRefOid` và `headRefOid` bằng `gh pr view`, fetch những commit còn thiếu từ `origin`, lấy diff từ `git merge-base <baseRefOid> <headRefOid>` tới `headRefOid`, và đưa thêm tiêu đề, mô tả PR vào facts.
   Cách tính này khớp đúng số file và số dòng GitHub hiển thị trên 3 PR thật của `hiinguyen/lightrag`, gồm PR merge commit, PR fast-forward và PR có base là nhánh feature.
   Mô tả PR là dữ liệu do người viết, nên judge coi nó là dữ liệu chứ không phải chỉ dẫn, như với commit message.
4. PR bị đóng mà không merge thì không chấm.

### Trạng thái trong ledger

| Trạng thái | Nghĩa | Tính vào level? |
|---|---|---|
| `queued` | Đang chờ chấm hoặc chờ xác nhận push | Không |
| `scored` | Đã chấm | Có |
| `push_failed` | Push không bao giờ tới được remote | Không |
| `superseded` | Commit không còn trên nhánh mặc định (force-push viết lại lịch sử) | Không |
| `reverted` | Mọi commit của đơn vị đã bị revert sau đó | Không, XP về 0 |
| `failed` | Chấm lỗi sau 3 lần thử | Không, `evolo retry` để chấm lại |
| `needs_review` | Nghi prompt injection | Không, chờ người xem |

`evolo sync` cũng kiểm tra `superseded` và `reverted` cho các đơn vị gần đây.
Revert một phần (chỉ vài commit trong đơn vị) được ghi lại nhưng chưa đổi XP; cách xử lý để dành cho giai đoạn hiệu chỉnh.

## 5. Judge chạy bằng Claude

Lệnh sau đã được kiểm chứng trên Claude Code 2.1.289 và đã cài trong `packages/cli/src/judges/claude.mjs`:

```bash
EVOLO_JUDGE=1 claude -p \
  --restricted --strict-mcp-config --no-session-persistence \
  --model <model đã ghim theo rubric_version> \
  --tools "Read,Grep,Glob,Bash" \
  --settings '{"permissions":{"allow":["Bash(git log:*)", "..."]}}' \
  --add-dir <thư mục input> \
  --append-system-prompt-file judge/xp-judge.md \
  --json-schema "$(cat judge/output.schema.json)" \
  --max-budget-usd 1 \
  --output-format stream-json --verbose \
  "Evaluate a push to the default branch: the change <base>..<tip> (N commits). Input files: <facts.json, repo-context.json, change.diff>"
```

Mỗi cờ có một lý do:

- `--restricted` bỏ qua settings của người dùng, của project và local, nên hooks, plugin và permission của người dùng không lọt vào.
  Đây là bản tương đương `OPENCODE_DISABLE_PROJECT_CONFIG` và cũng chặn lỗi MCP caveman đã gặp với opencode.
  Khác với `--bare`, nó vẫn dùng được đăng nhập OAuth (gói Claude của bạn), không bắt buộc API key.
  Đã thử: một `CLAUDE.md` đặt trong repo và `~/.claude/CLAUDE.md` của người dùng đều lọt vào prompt khi không có cờ này, và không lọt khi có cờ này.
- `--strict-mcp-config` để judge không có MCP server nào.
- `--add-dir` vì `--restricted` chỉ cho đọc file trong thư mục làm việc, mà các file input nằm ở thư mục tạm riêng.
- `--tools` cùng `--settings` cho phép đúng các lệnh git chỉ-đọc: `Bash(git log:*)`, `Bash(git show:*)` và các lệnh tương tự.
  Danh sách này là `READ_ONLY_COMMANDS` trong `src/judges/common.mjs`, dùng chung để sinh quyền cho cả backend opencode.
  Trong chế độ `-p`, mọi lệnh khác bị từ chối vì không có ai bấm duyệt.
  Riêng các lệnh chỉ-đọc có sẵn như `grep`, `head`, `tail` thì Claude Code tự cho phép.
  Lệnh bị từ chối được ghi vào trường `deniedCommands` của kết quả.
  Đã thử: `git log` chạy được, `touch` bị từ chối và không tạo file nào.
- `--json-schema` để Claude buộc đầu ra đúng schema, trả về trong trường `structured_output`.
  Bộ validator của Evolo vẫn chạy sau đó, vì schema chỉ kiểm hình dạng chứ không kiểm bằng chứng.
- `--max-budget-usd` chặn trần chi phí cho mỗi lần chấm.
  Chạm trần là lỗi không thử lại (`FatalJudgeError`), để không tốn gấp ba.
- `stream-json` để theo dõi từng tool call trong lúc chấm. Kết quả cuối nằm ở sự kiện `result`, cùng với chi phí.
- `EVOLO_JUDGE=1` là chốt an toàn chống đệ quy: dù judge không có quyền commit, shim vẫn bỏ qua mọi commit tạo ra khi biến này được bật.

Thư mục làm việc là git worktree tại commit cuối (`tip`) của change set.
Để repo không tự định nghĩa lại agent, prompt của judge được truyền qua `--append-system-prompt-file`, không qua `.claude/agents/` trong repo.

**Ghim model:** mỗi `rubric_version` gắn với một model cố định, ghi vào ledger.
Đổi model là đổi phiên bản, và không trộn điểm của hai model trên cùng một bảng xếp hạng nếu chưa hiệu chỉnh lại bằng golden set.
Mặc định là `claude-sonnet-5-5` (`DEFAULT_CLAUDE_MODEL` trong `src/judges/claude.mjs`).

### Kết quả so sánh model trên 6 commit của Friday (2026-10-18)

| Commit | Opencode (deepseek) | Sonnet 5.5 lần 1 | Sonnet 5.5 lần 2 | Haiku 4.5 |
|---|---|---|---|---|
| `08ab8ab` feature, 2046 dòng | 216 | 174 | 204 | 216 |
| `4b5aa48` feature, 822 dòng | 216 | 174 | 174 | 134 |
| `61e69bc` bugfix, 70 dòng | 104 | 74 | 78 | 68 |
| `6db9a46` refactor, 179 dòng | 62 | 62 | 51 | 80 |
| `1ecc693` chore, 1 dòng | 4 | 3 | 3 | 2 |
| `aa09361` docs (luật) | 7 | 7 | 7 | 7 |
| Thời gian mỗi commit | 5-15 phút | 8-17 giây | 8-15 giây | 1,5-2,5 phút |
| Chi phí cả 6 commit | không đo | ~$0.37 | ~$0.36 | ~$0.82 |
| Tool call mỗi commit | 18-31 | 2-3 | 2-3 | 18-28 |

Lý do chọn Sonnet:
- Thứ tự xếp hạng giống nhau qua hai lần chạy, mỗi tiêu chí lệch tối đa 1 điểm.
- Nhanh hơn Haiku khoảng 10 lần và rẻ hơn một nửa.
- Haiku xếp bản refactor không đổi hành vi cao hơn bản sửa lỗi camera, và cho feature lớn nhất điểm tối đa ở mọi tiêu chí.

Sonnet chỉ đọc facts và toàn bộ diff rồi chấm, không chạy `git grep` tìm nơi gọi.
Lý do `centrality` của nó vẫn hợp lý trên Friday, vì diff đầy đủ cộng với bản đồ module trong `repo-context.json` là đủ cho một repo nhỏ.

Rủi ro còn mở:
- Commit lớn dao động khoảng ±18% giữa hai lần chạy (174 so với 204 XP).
- Chưa kiểm chứng trên repo lớn, nơi bản đồ module không đủ để biết một hàm được gọi ở bao nhiêu nơi.
  Golden set (`docs/architecture.md`, giai đoạn 3) phải có repo lớn để kiểm tra điều này.

Bài học khi chạy thử: câu "be efficient, at most about 10 steps" viết cho model opencode chậm làm Sonnet đọc diff bằng `head` rồi chấm với cờ `incomplete_investigation`.
Prompt giờ bắt buộc đọc hết diff, và validator loại mọi kết quả mà judge tự nhận là điều tra chưa đủ.

## 6. Xem kết quả trong Claude Code

- **Thông báo:** khi chấm xong, worker gửi thông báo desktop (`notify-send` trên Linux) dạng "Friday push 61e69bc..a1b2c3d: bugfix +104 XP" hoặc "Evolo PR #12: feature +174 XP".
- **Status line (tuỳ chọn):** `evolo init --statusline` thêm một đoạn vào status line của Claude Code: `Lv 7 · 1.240 XP · +104 hôm nay`.
  Đoạn này chỉ đọc file tổng hợp trong ledger nên tốn dưới 10 ms.
  Status line chỉ người thấy, không vào context của model, nên không gây vấn đề Goodhart ở mục 1.
- **Skill `/evolo`:** cài vào `~/.claude/skills/evolo/`, dùng cho mọi repo, với các lệnh:
  - `/evolo` - tóm tắt điểm hôm nay và tuần này, kèm lý do của từng đơn vị.
  - `/evolo why <sha|#pr>` - giải thích chi tiết một lần chấm: các điểm rubric, bằng chứng và breakdown của công thức.
  - `/evolo backfill 30d` - chấm bù các lần push và PR trong 30 ngày gần nhất.
  - `/evolo retry` - chấm lại các đơn vị `failed`.
  - `/evolo preview` - chấm thử các commit chưa push, không ghi vào ledger.

  Skill chỉ gọi CLI `evolo` và đọc ledger.
  Nó không tự chấm, nên kết quả luôn đến từ cùng một judge.

## 7. Độ bền

| Tình huống | Xử lý |
|---|---|
| Push liên tục nhiều lần | Tất cả vào hàng đợi, 1 worker chấm lần lượt theo thứ tự push |
| Push bị remote từ chối | Worker không thấy commit trên remote sau 10 phút, đánh dấu `push_failed`, không gọi judge |
| Mất mạng, `claude` hoặc `gh` chưa đăng nhập, hết quota | Job vẫn ở `queued`, worker thử lại với backoff, `evolo status` hiện lý do |
| Máy tắt khi đang chấm | Lock có PID. Lần enqueue sau thấy PID chết thì gỡ lock, xoá worktree mồ côi (`git worktree prune`) và chạy lại |
| Judge treo | Timeout cho mỗi lần thử, giết tiến trình con (đã có trong `judges/common.mjs`) |
| Đầu ra sai schema hoặc thiếu bằng chứng | Thử lại tối đa 3 lần, sau đó là `failed` |
| Chi phí tăng vọt | `--max-budget-usd` cho mỗi lần chấm, cộng với trần theo ngày trong `~/.evolo/config.json`. Vượt trần thì job chờ sang ngày sau |
| Repo bị xoá hoặc di chuyển | Worker bỏ qua các mục trong hàng đợi có đường dẫn không còn tồn tại và báo trong `evolo status` |

Hàng đợi và ledger là các file JSON, mỗi job hoặc đơn vị một file, ghi theo kiểu atomic (ghi file tạm rồi `rename`).
Nhờ vậy không cần database, không bao giờ đọc phải file ghi dở, và dễ debug bằng `cat`.

## 8. Bảo mật và quyền riêng tư

- Diff và code được gửi lên Claude qua tài khoản của chính bạn, giống như khi bạn code bằng Claude.
  Repo nào không muốn gửi thì không chạy `evolo init` ở đó, hoặc đặt `exclude` trong `repos.json`.
- Ledger chỉ lưu facts, điểm, lý do và đường dẫn bằng chứng, không lưu code.
- Judge không ghi được file, không có mạng (vì không có WebFetch), không có MCP và không đọc settings của người dùng.
- Repo được chấm có thể chứa nội dung cố tình nhắm vào giám khảo.
  Các quy tắc tin cậy và cờ `suspected_injection` trong `xp-judge.md` vẫn áp dụng, và đơn vị bị gắn cờ sẽ ở trạng thái `needs_review`.
- Evolo hiện chỉ dùng cá nhân nên không có cơ chế chống gian lận; ledger là file trên máy người dùng.

## 9. Cấu trúc code đề xuất

```
packages/cli/                 # gói npm "evolo"
  bin/evolo.mjs               # [có] evaluate --range/--pr/<sha> | [chưa] init, uninstall, enqueue, worker, sync, status, why, backfill, retry, preview
  src/evaluate.mjs            # [có] facts → triage → worktree → judge → validate → xp cho một change set
  src/facts.mjs               # [có] số liệu diff ròng base..tip, danh sách commit, revert, thông tin PR
  src/score.mjs               # [có] triage, validator, công thức XP
  src/judges/common.mjs       # [có] READ_ONLY_COMMANDS, chạy tiến trình JSONL, timeout, dọn tiến trình con
  src/judges/claude.mjs       # [có] backend claude -p (mục 5), mặc định
  src/judges/opencode.mjs     # [có] backend opencode, sinh file agent tạm từ judge/xp-judge.md
  src/hooks.mjs               # [chưa] cài và gỡ hook pre-push, tôn trọng core.hooksPath, chain hook cũ
  src/queue.mjs               # [chưa] hàng đợi file, lock có PID, ghi atomic
  src/worker.mjs              # [chưa] vòng lặp gọi evaluate.mjs cho từng mục trong hàng đợi
  src/units.mjs               # [có] dải push, commit đơn, PR qua gh thành change set | [chưa] lọc commit của push, phát hiện PR merge
  src/ledger.mjs              # [chưa] trạng thái, superseded và reverted khi sync
  judge/xp-judge.md           # [có] rubric và prompt: một nguồn duy nhất cho cả hai backend
  judge/output.schema.json    # [có] schema đầu ra, có test kiểm tra khớp với validator
skills/evolo/SKILL.md         # [chưa] skill /evolo
```

Chạy test: `cd packages/cli && npm test`.
Chấm thử: `node packages/cli/bin/evolo.mjs evaluate --repo <clone> --out <dir> --own [--judge opencode] [--model M] [--range <from>..<to>]... [--pr <number>]... [<sha>...]`.

## 10. Lộ trình

1. **Judge Claude:** xong, Sonnet là mặc định (mục 5).
2. **Change set và PR:** xong (2026-10-18), xem `docs/handoff.md` mục 3.
3. **Hook, hàng đợi, sync:** `init`, `uninstall`, `enqueue`, `worker`, `sync`, kèm test E2E trên một repo tạm có remote giả (bare repo).
   Test này push thành công, push bị từ chối, force-push, merge PR (qua `gh` giả lập), revert, rồi kiểm tra trạng thái trong ledger.
4. **Hiển thị:** thông báo desktop, `status`, `why`, skill `/evolo` và status line.

Hiệu chỉnh bằng golden set và các phần game hoá nằm trong lộ trình chung ở `docs/architecture.md` mục 11.

## 11. Câu hỏi mở

- Có chấm cả repo của tổ chức hay công ty không?
  Nếu có thì cần tuỳ chọn tắt gửi code theo từng remote, vì chính sách công ty có thể không cho phép.
- Thông báo desktop có làm phiền không?
  Có thể chỉ hiện trong status line.
