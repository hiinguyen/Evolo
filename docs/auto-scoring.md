# Evolo: chấm XP tự động sau mỗi commit

Tài liệu này mô tả cách nhúng hệ thống chấm XP (xem `docs/xp-evaluation.md`) vào một dự án để mỗi commit được chấm tự động bằng Claude.
Mục tiêu: chạy `evolo init` một lần trong repo, sau đó cứ commit là có điểm, không phải làm gì thêm.

## 1. Quyết định chính

| Câu hỏi | Quyết định | Lý do ngắn |
|---|---|---|
| Cái gì kích hoạt việc chấm? | Git hook `post-commit` và `post-rewrite` | Bắt mọi commit, dù do Claude, IDE hay gõ tay |
| Ai chấm? | Một tiến trình `claude -p` riêng, sandbox chỉ-đọc | Không để agent vừa viết code tự chấm mình |
| Chấm lúc nào? | Nền, sau khi commit xong, không chặn commit | Commit phải nhanh như bình thường |
| Cấu hình judge nằm đâu? | Trong bản cài Evolo (`~/.evolo`), không nằm trong repo | Repo được chấm không sửa được giám khảo |
| Kết quả lưu đâu? | `~/.evolo/ledger/`, không commit vào repo | Không làm bẩn lịch sử, đồng đội không bị ảnh hưởng |
| Skill dùng để làm gì? | `/evolo` để xem điểm, chấm lại, chấm bù | Skill không tự kích hoạt được, nên chỉ dùng cho thao tác chủ động |
| Điểm nào được tính vào level? | Chỉ commit đã lên nhánh mặc định trên remote | Commit bị amend, rebase hay bỏ đi thì không tính |

### Vì sao không dùng hook của Claude Code làm trigger

Claude Code có hook `PostToolUse` bắt được lệnh `git commit` mà Claude chạy.
Tôi không chọn cách này làm trigger chính vì ba lý do:

- Nó chỉ bắt commit do Claude chạy qua Bash, bỏ sót commit gõ tay, commit từ IDE, `git commit --amend` và rebase.
- Nó gắn việc chấm vào phiên code, nên nếu phiên bị đóng giữa chừng thì việc chấm cũng mất.
- Git hook là nơi duy nhất biết chắc "một commit vừa được tạo", bất kể công cụ nào tạo ra nó.

### Vì sao không để chính phiên Claude đang code tự chấm

- **Xung đột lợi ích:** agent viết code và chấm code là một, nên điểm sẽ thiên vị.
- **Goodhart:** nếu agent code thấy rubric và điểm, nó sẽ tối ưu cho điểm thay vì cho chất lượng. Ví dụ, nó có thể thêm test chỉ để mở trần điểm quality.
- **Ô nhiễm context:** việc chấm tốn hàng chục tool call, làm đầy context của phiên đang code.
- **Cấu hình lẫn lộn:** phiên code có hooks, MCP và CLAUDE.md của người dùng, trong khi judge cần môi trường sạch và giống nhau ở mọi máy.

Vì vậy điểm được báo cho **người**, qua thông báo, status line và `/evolo`, chứ không đưa ngược vào context của agent đang code.

## 2. Kiến trúc

```
git commit
   │
   ▼
.git/hooks/post-commit  ──►  evolo enqueue <repo> <sha>     (< 50 ms, chỉ ghi 1 file)
                                   │
                                   ▼
                         ~/.evolo/queue/<repo-id>/<sha>.json
                                   │
                                   ▼  (spawn tách rời nếu chưa có worker)
                         evolo worker  (1 worker toàn máy, giữ lock)
                           1. facts      git đo số liệu (facts.mjs)
                           2. triage     docs/lockfile nhỏ → chấm bằng luật, xong
                           3. worktree   checkout tạm tại sha
                           4. judge      claude -p trong sandbox chỉ-đọc
                           5. validate   kiểm bằng chứng, cap điểm (score.mjs)
                           6. xp         công thức tất định (computeXp)
                           7. ledger     ~/.evolo/ledger/<repo-id>/<sha>.json
                           8. notify     thông báo desktop + cập nhật status line
```

Bước 1, 2, 5, 6 dùng lại nguyên code đã có trong `packages/cli/src/`.
Chỉ bước 4 thay opencode bằng Claude, và rubric vẫn là một file prompt duy nhất dùng chung cho cả hai backend.

## 3. Cài đặt: `evolo init`

```bash
cd ~/code/my-project
npx evolo init          # hoặc: evolo init nếu đã cài global
```

`evolo init` làm đúng các việc sau, và in ra từng việc:

1. Kiểm tra `claude` đã cài và đăng nhập, bằng một lệnh `claude -p` rẻ nhất có thể. Nếu lỗi thì dừng và hướng dẫn.
2. Tìm thư mục hook thật: `git rev-parse --git-path hooks`. Lệnh này tôn trọng `core.hooksPath`, nên chạy đúng cả với husky và với worktree.
3. Ghi shim vào `post-commit` và `post-rewrite`.
   Nếu đã có hook cũ, giữ nguyên và thêm một dòng gọi Evolo, nằm giữa hai dòng đánh dấu `# >>> evolo` và `# <<< evolo` để gỡ sạch được.
4. Đăng ký repo vào `~/.evolo/repos.json`: đường dẫn, remote, nhánh mặc định, có phải repo của mình không (`isOwnRepo`) và số sao. Số sao lấy bằng `gh` nếu có.
5. Hỏi có muốn chấm bù N commit gần nhất của mình không. Mặc định là 0.

Không có file nào được thêm vào repo hay được commit.
Hook nằm trong `.git/`, nên chỉ máy này có, đồng đội clone về không bị ảnh hưởng.
Gỡ cài đặt bằng `evolo uninstall`: xoá đoạn giữa hai dòng đánh dấu, xoá repo khỏi `repos.json`, và giữ nguyên ledger.

Shim chỉ có vài dòng và không bao giờ làm commit thất bại:

```sh
# >>> evolo
[ -n "$EVOLO_JUDGE" ] || evolo enqueue --hook post-commit "$@" >/dev/null 2>&1 || true
# <<< evolo
```

## 4. Vòng đời một commit

Commit local chưa phải đóng góp thật, vì nó có thể bị amend, squash hay bỏ đi.
Vì vậy mỗi bản ghi trong ledger có một trạng thái:

| Trạng thái | Nghĩa | Tính vào level? |
|---|---|---|
| `queued` | Đang chờ chấm | Không |
| `provisional` | Đã chấm, commit mới chỉ có ở local | Không, nhưng hiện ra dạng "+104 XP (chờ push)" |
| `confirmed` | Commit đã nằm trên nhánh mặc định của remote | Có |
| `superseded` | Bị amend hoặc rebase thành SHA khác | Không |
| `reverted` | Đã bị revert sau đó | Không, XP về 0 |
| `failed` | Chấm lỗi sau 3 lần thử | Không, `evolo retry` để chấm lại |
| `needs_review` | Nghi prompt injection | Không, chờ người xem |

Các trường hợp đặc biệt:

- **`git commit --amend` và rebase:** `post-rewrite` nhận danh sách cặp `cũ mới`.
  Bản cũ chuyển sang `superseded`.
  Bản mới được đưa vào hàng đợi.
  Nếu diff của bản mới giống hệt bản cũ (so sánh `git patch-id`), Evolo chép lại điểm cũ mà không gọi AI, nên rebase một chuỗi dài không tốn tiền.
- **Đang rebase:** git chạy `post-commit` cho từng commit được replay.
  Shim bỏ qua khi đang có rebase, phát hiện bằng thư mục `rebase-merge` hoặc `rebase-apply`, và để `post-rewrite` xử lý một lần ở cuối.
- **Merge commit:** không chấm. Các commit con được chấm riêng, còn luồng PR sẽ có thiết kế riêng sau.
- **Commit của người khác:** chỉ chấm commit có author email khớp với email đã đăng ký.
  Ví dụ khi `git pull --rebase` rebase lại commit của người khác thì không chấm.
- **Xác nhận:** sau mỗi lần chấm xong, và khi gọi `evolo sync`, worker chạy `git fetch` rồi kiểm tra `git merge-base --is-ancestor <sha> origin/<default>`.
  Commit nào đã lên remote thì chuyển sang `confirmed`.

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
  "Evaluate commit <sha>. Input files: <facts.json, repo-context.json, change.diff>"
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

Thư mục làm việc là git worktree tại đúng SHA đó, giống bản prototype đã chạy với opencode.
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
  Golden set (lộ trình bước 4) phải có repo lớn để kiểm tra điều này.

Bài học khi chạy thử: câu "be efficient, at most about 10 steps" viết cho model opencode chậm làm Sonnet đọc diff bằng `head` rồi chấm với cờ `incomplete_investigation`.
Prompt giờ bắt buộc đọc hết diff, và validator loại mọi kết quả mà judge tự nhận là điều tra chưa đủ.

## 6. Xem kết quả trong Claude Code

- **Thông báo:** khi chấm xong, worker gửi thông báo desktop (`notify-send` trên Linux) dạng "Friday 61e69bc: bugfix +104 XP (chờ push)".
- **Status line (tuỳ chọn):** `evolo init --statusline` thêm một đoạn vào status line của Claude Code: `Lv 7 · 1.240 XP · +104 hôm nay`.
  Đoạn này chỉ đọc file tổng hợp trong ledger nên tốn dưới 10 ms.
  Status line chỉ người thấy, không vào context của model, nên không gây vấn đề Goodhart ở mục 1.
- **Skill `/evolo`:** cài vào `~/.claude/skills/evolo/`, dùng cho mọi repo, với các lệnh:
  - `/evolo` - tóm tắt điểm hôm nay và tuần này, kèm lý do của từng commit.
  - `/evolo why <sha>` - giải thích chi tiết một lần chấm: các điểm rubric, bằng chứng và breakdown của công thức.
  - `/evolo backfill 20` - chấm bù 20 commit gần nhất.
  - `/evolo retry` - chấm lại các commit `failed`.

  Skill chỉ gọi CLI `evolo` và đọc ledger.
  Nó không tự chấm, nên kết quả luôn đến từ cùng một judge.

## 7. Độ bền

| Tình huống | Xử lý |
|---|---|
| Commit liên tục 10 cái | Tất cả vào hàng đợi, 1 worker chấm lần lượt theo thứ tự commit |
| Mất mạng, `claude` chưa đăng nhập, hết quota | Commit vẫn ở `queued`, worker thử lại với backoff, `evolo status` hiện lý do |
| Máy tắt khi đang chấm | Lock có PID. Lần enqueue sau thấy PID chết thì gỡ lock, xoá worktree mồ côi (`git worktree prune`) và chạy lại |
| Judge treo | Timeout cho mỗi lần thử, giết tiến trình con (đã có trong `judge.mjs`) |
| Đầu ra sai schema hoặc thiếu bằng chứng | Thử lại tối đa 3 lần, sau đó là `failed` |
| Chi phí tăng vọt | `--max-budget-usd` cho mỗi commit, cộng với trần theo ngày trong `~/.evolo/config.json`. Vượt trần thì commit chờ sang ngày sau |
| Repo bị xoá hoặc di chuyển | Worker bỏ qua các mục trong hàng đợi có đường dẫn không còn tồn tại và báo trong `evolo status` |

Hàng đợi và ledger là các file JSON, mỗi commit một file, ghi theo kiểu atomic (ghi file tạm rồi `rename`).
Nhờ vậy không cần database, không bao giờ đọc phải file ghi dở, và dễ debug bằng `cat`.

## 8. Bảo mật và quyền riêng tư

- Diff và code được gửi lên Claude qua tài khoản của chính bạn, giống như khi bạn code bằng Claude.
  Repo nào không muốn gửi thì không chạy `evolo init` ở đó, hoặc đặt `exclude` trong `repos.json`.
- Ledger chỉ lưu facts, điểm, lý do và đường dẫn bằng chứng, không lưu code.
- Judge không ghi được file, không có mạng (vì không có WebFetch), không có MCP và không đọc settings của người dùng.
- Repo được chấm có thể chứa nội dung cố tình nhắm vào giám khảo.
  Các quy tắc tin cậy và cờ `suspected_injection` trong `xp-judge.md` vẫn áp dụng, và commit bị gắn cờ sẽ ở trạng thái `needs_review`.
- Ledger nằm trên máy người dùng nên người dùng sửa được.
  Với bảng xếp hạng công khai sau này, server phải tự chấm lại từ GitHub và không tin ledger local.
  Ledger local chỉ phục vụ phản hồi nhanh cho cá nhân.

## 9. Cấu trúc code đề xuất

```
packages/cli/                 # gói npm "evolo"
  bin/evolo.mjs               # [có] evaluate | [chưa] init, uninstall, enqueue, worker, sync, status, why, backfill, retry
  src/evaluate.mjs            # [có] facts → triage → worktree → judge → validate → xp cho một commit
  src/facts.mjs               # [có] số liệu đo bằng git
  src/score.mjs               # [có] triage, validator, công thức XP
  src/judges/common.mjs       # [có] READ_ONLY_COMMANDS, chạy tiến trình JSONL, timeout, dọn tiến trình con
  src/judges/claude.mjs       # [có] backend claude -p (mục 5), mặc định
  src/judges/opencode.mjs     # [có] backend opencode, sinh file agent tạm từ judge/xp-judge.md
  src/hooks.mjs               # [chưa] ghi và gỡ shim, tôn trọng core.hooksPath, chain hook cũ
  src/queue.mjs               # [chưa] hàng đợi file, lock có PID, ghi atomic
  src/worker.mjs              # [chưa] vòng lặp gọi evaluate.mjs cho từng mục trong hàng đợi
  src/ledger.mjs              # [chưa] trạng thái, confirm qua merge-base, supersede qua post-rewrite
  judge/xp-judge.md           # [có] rubric và prompt: một nguồn duy nhất cho cả hai backend
  judge/output.schema.json    # [có] schema đầu ra, có test kiểm tra khớp với validator
skills/evolo/SKILL.md         # [chưa] skill /evolo
```

Chạy test: `cd packages/cli && npm test`.
Chấm thử: `node packages/cli/bin/evolo.mjs evaluate --repo <clone> --out <dir> --own [--judge opencode] [--model M] <sha>...`.

## 10. Lộ trình

1. **Judge Claude:** viết `judges/claude.mjs`, chạy lại 6 commit Friday và so điểm với opencode.
   Đo chi phí và thời gian thật cho mỗi commit với `sonnet` và `haiku`.
2. **Hook và hàng đợi:** `init`, `uninstall`, `enqueue`, `worker`, kèm test E2E trên một repo tạm.
   Test này commit, amend, rebase và revert thật, rồi kiểm tra trạng thái trong ledger.
3. **Hiển thị:** thông báo desktop, `status`, `why`, skill `/evolo` và status line.
4. **Hiệu chỉnh:** golden set khoảng 30 commit chấm tay, chạy mỗi commit 3 lần để đo độ lệch, rồi sửa trần điểm ở mức 216 XP.
5. **Đồng bộ lên server:** chỉ gửi commit `confirmed`, và server chấm lại từ GitHub để xác thực.

## 11. Câu hỏi mở

- Có chấm cả repo của tổ chức hay công ty không?
  Nếu có thì cần tuỳ chọn tắt gửi code theo từng remote, vì chính sách công ty có thể không cho phép.
- Thông báo desktop có làm phiền không?
  Có thể gộp lại, ví dụ mỗi 30 phút một lần, hoặc chỉ hiện trong status line.
