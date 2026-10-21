# Evolo: chấm XP tự động sau mỗi lần push và mỗi PR

Tài liệu này mô tả cách nhúng hệ thống chấm XP (xem `docs/xp-evaluation.md`) vào một dự án để mỗi đóng góp được chấm tự động bằng Claude.
Mục tiêu: chạy `evolo init` một lần trong repo, sau đó cứ push hoặc merge PR là có điểm, không phải làm gì thêm.

Trạng thái (2026-10-19): đã xây và đã có test E2E cho mục 2-4 và 7.
Mục 6 đã có thông báo, `status`, `why`, `retry`, `statusline`, skill `/evolo` và hook `SessionStart`; còn `backfill` và `preview`.
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
| Skill dùng để làm gì? | `/evolo` để xem điểm, giải thích, chấm lại | Skill không tự kích hoạt được, nên chỉ dùng cho thao tác chủ động |

### Vì sao không dùng hook của Claude Code làm trigger

Claude Code có hook `PostToolUse` bắt được lệnh `git push` mà Claude chạy.
Tôi không chọn cách này làm trigger chính vì hai lý do:

- Nó chỉ bắt lệnh do Claude chạy qua Bash, bỏ sót push gõ tay, push từ IDE và PR merge trên GitHub.
- Nó gắn việc chấm vào phiên code, nên nếu phiên bị đóng giữa chừng thì việc chấm cũng mất.

Hook `SessionStart` của Claude Code vẫn có ích như một trigger phụ: chạy `evolo sync` ở nền khi mở phiên, để bắt các PR đã merge trên web (chưa làm).
Hiện PR đã merge được bắt ở lần push kế tiếp (worker sync sau khi chấm) hoặc khi gọi `evolo sync`.

### Vì sao không để chính phiên Claude đang code tự chấm

- **Thiên vị:** agent viết code và chấm code là một.
- **Goodhart:** nếu agent code thấy rubric và điểm, nó sẽ tối ưu cho điểm thay vì cho chất lượng. Ví dụ, nó có thể thêm test chỉ để mở trần điểm quality.
- **Ô nhiễm context:** việc chấm cần đọc toàn bộ diff, làm đầy context của phiên đang code.
- **Cấu hình lẫn lộn:** phiên code có hooks, MCP và CLAUDE.md của người dùng, trong khi judge cần môi trường sạch và giống nhau mỗi lần.

Vì vậy điểm được báo cho **người**, qua thông báo, status line và `/evolo`, chứ không đưa ngược vào context của agent đang code.

## 2. Kiến trúc

```
git push ─► .git/hooks/pre-push ─► evolo enqueue push      (chỉ ghi 1 file rồi khởi động worker tách rời)
                                         │
evolo sync (sau khi worker chấm xong,    │
  hoặc gọi tay) ─► gh: PR nào            │
  của tôi vừa merge? ─► enqueue pr ──────┤
                                         ▼
                           ~/.evolo/queue/<job-id>.json
                                         │
                                         ▼  (spawn tách rời nếu chưa có worker)
                           evolo worker  (1 worker toàn máy, giữ lock)
                             0. land       push: chờ `git push` xong rồi xác nhận remote đã nhận; pr: fetch head của PR
                             1. units      chọn commit: của mình, không phải merge, chưa thuộc PR nào
                             2. facts      git đo số liệu cho cả change set (facts.mjs)
                             3. triage     docs/lockfile nhỏ → chấm bằng luật, xong
                             4. worktree   checkout tạm tại commit cuối của change set
                             5. judge      claude -p trong sandbox chỉ-đọc
                             6. validate   kiểm bằng chứng, cap điểm (score.mjs)
                             7. xp         công thức tất định (computeXp)
                             8. ledger     ~/.evolo/ledger/<owner>/<name>/<unit-id>.json
                             9. notify     thông báo desktop + cập nhật status line (chưa làm)
```

Bước 0, 1 và 8 nằm trong `worker.mjs` và `ledger.mjs`; bước 2-7 là `evaluate.mjs`.
`units.mjs` biến một lần push hoặc một số PR thành change set và chọn commit được tính (bước 1); `facts.mjs` đo nó và `evaluate.mjs` chấm nó.
Phần chưa có là bước 9 (thông báo), thuộc phần hiển thị.

## 3. Cài đặt: `evolo init`

```bash
cd ~/code/my-project
evolo init
```

`evolo init` làm đúng các việc sau, và in ra từng việc:

1. Kiểm tra `claude` đã cài (`claude --version`; chưa kiểm tra đăng nhập, vì lệnh rẻ nhất vẫn tốn một lượt gọi model). `gh` phải đăng nhập được, vì bước 4 đọc repo bằng `gh`. Nếu lỗi thì dừng và báo lý do.
2. Tìm thư mục hook thật: `git rev-parse --git-path hooks`. Lệnh này tôn trọng `core.hooksPath`, nên chạy đúng cả với husky và với worktree.
3. Cài hook `pre-push` (chi tiết bên dưới).
4. Đăng ký repo vào `~/.evolo/repos.json`, khoá là `owner/name` trên GitHub:
   đường dẫn clone, thư mục git chung (để mọi worktree của clone đều khớp), remote trỏ tới repo GitHub (chọn bằng `remoteFor` trong `src/github.mjs`, hoặc `--remote`), nhánh mặc định, email tác giả (`git config user.email` cộng các `--author`), có phải repo của mình không (`isOwnRepo`: chủ repo là tài khoản `gh` đang đăng nhập), số sao, và `since`: thời điểm đăng ký.
   PR merge trước `since` không được chấm; chạy lại `init` giữ nguyên `since` cũ.
5. (Chưa làm) Hỏi có muốn chấm bù các PR đã merge và các commit đã push trong N ngày gần nhất không. Mặc định là không.

Không có file nào được thêm vào repo hay được commit.
Hook nằm trong `.git/`, nên chỉ máy này có, đồng đội clone về không bị ảnh hưởng.
Gỡ cài đặt bằng `evolo uninstall`: khôi phục hook cũ, xoá repo khỏi `repos.json`, và giữ nguyên ledger.

### Hook `pre-push`

Git không có hook `post-push`, nên Evolo dùng `pre-push` để ghi lại việc sắp push, rồi worker tự kiểm tra push có thành công không.
Git truyền cho `pre-push` danh sách ref qua stdin, mỗi dòng là `<local ref> <local sha> <remote ref> <remote sha>`.
Nếu repo đã có hook `pre-push`, stdin chỉ đọc được một lần, nên Evolo đổi tên hook cũ thành `pre-push.evolo-chained` và chuyển stdin cho cả hai:

```sh
#!/bin/sh
# Installed by evolo. `evolo uninstall` removes it; the previous pre-push hook, if any, is pre-push.evolo-chained.
input=$(cat)
[ -n "$input" ] && input="$input
"
if [ -z "$EVOLO_JUDGE" ]; then
  printf '%s' "$input" | '<node>' '<evolo.mjs>' enqueue push --pusher "$PPID" -- "$@" >/dev/null 2>&1 || true
fi
chained="$(dirname "$0")/pre-push.evolo-chained"
if [ -x "$chained" ]; then
  printf '%s' "$input" | "$chained" "$@"
  exit $?
fi
exit 0
```

Phần của Evolo không bao giờ làm push thất bại; chỉ hook cũ mới có quyền chặn push, đúng như trước khi cài.
Hook gọi Evolo bằng đường dẫn tuyệt đối tới `node` và `evolo.mjs`, vì git có thể chạy hook với một `PATH` khác (IDE, GUI).
`$PPID` của hook là tiến trình `git push`; worker dùng nó để biết lúc nào push đã kết thúc.
Lỗi của `enqueue` được ghi vào `~/.evolo/evolo.log`, vì hook không in gì ra terminal.

## 4. Vòng đời một đơn vị

### Push

1. `enqueue push` chỉ giữ các lần cập nhật nhánh mặc định trên đúng remote đã đăng ký (so theo tên remote, vì URL hook nhận được đã qua `insteadOf`), bỏ lệnh xoá nhánh, và ghi job `{remote, ref, from: remote sha, to: local sha, pusher: PID của git push}`.
2. Worker xác nhận push thành công: `git ls-remote` lấy commit của nhánh trên remote (fetch nếu máy chưa có), rồi kiểm tra `to` là tổ tiên của nó.
   Chưa thấy và `git push` còn chạy thì hỏi lại sau 1 giây.
   Chưa thấy mà `git push` đã kết thúc thì push đã bị từ chối: ghi `push_failed` ngay, không gọi judge.
   Worker kiểm tra tiến trình trước rồi mới hỏi remote; làm ngược lại thì một push vừa xong giữa hai bước sẽ bị coi là thất bại.
   Job không biết PID thì được chờ tối đa 10 phút.
3. Chọn commit (đã có trong `units.mjs`): lấy các commit không phải merge trong `from..to`, rồi bỏ:
   - commit có email tác giả không nằm trong danh sách email đã đăng ký;
   - commit được một PR đã merge chấm rồi.
     GitHub cho biết commit liên kết với PR đã merge nào, bằng một truy vấn GraphQL cho tối đa 100 commit (`mergedPrsOfCommits` trong `src/github.mjs`).
     Liên kết này đúng với cả ba kiểu merge (merge commit, squash, rebase), nhưng GitHub cũng liên kết cả commit đã nằm trên nhánh đích trước khi PR được merge.
     Vì vậy commit là tổ tiên của commit base của PR thì vẫn thuộc lần push; nếu không, nó sẽ không được chấm ở đâu cả.
     Máy không có commit base của PR thì tin GitHub.
   Nếu `from` toàn số 0 (nhánh mặc định chưa có trên remote, tức lần push đầu), đơn vị là toàn bộ lịch sử của `to`.
   Sau force-push (`from` không phải tổ tiên của `to`), đơn vị bắt đầu từ `git merge-base from to`: chỉ các commit mới được tính, còn đơn vị cũ chứa commit bị bỏ thành `superseded` ở lần sync sau.
   Máy không có `from` (force-push đè lên commit chưa từng fetch) thì worker fetch nó theo SHA từ remote; GitHub vẫn phục vụ commit đã mất khỏi nhánh.
   Không fetch được thì đơn vị thành `failed` ngay, kèm lý do.
4. Không còn commit nào thì xong, không tốn lần gọi judge nào.
   Không bỏ commit nào thì chấm diff ròng `from..to`.
   Có bỏ commit thì chấm từng commit còn lại ghép nối (`diffMode: "per-commit"`): số liệu cộng dồn từng commit, diff là các patch nối nhau, và các commit bị bỏ được ghi trong `excluded` kèm lý do.
   Dòng bị hai commit cùng sửa thì được tính hai lần; đó là cái giá chấp nhận được cho một trường hợp hiếm.

### PR

1. `evolo sync` hỏi `gh pr list --author @me --state merged --base <nhánh mặc định>` các PR merge từ lúc đăng ký (`since`), cho mọi repo đã đăng ký.
   Worker tự sync mỗi khi đã chấm xong và không còn job nào mới hay đang chờ push tới nơi, tức sau mỗi lần push.
2. PR chưa có trong ledger và chưa nằm trong hàng đợi thành một job `{type: "pr", repo, number}`.
3. Worker lấy `baseRefOid` và `headRefOid` bằng `gh pr view`, fetch `refs/pull/<number>/head` khi thiếu commit, từ remote đã đăng ký (trong clone của một fork, đó không phải `origin`), lấy diff từ `git merge-base <baseRefOid> <headRefOid>` tới `headRefOid`, và đưa thêm tiêu đề, mô tả PR vào facts.
   Cách tính này khớp đúng số file và số dòng GitHub hiển thị trên 3 PR thật của `hiinguyen/lightrag`, gồm PR merge commit, PR fast-forward và PR có base là nhánh feature.
   Mô tả PR là dữ liệu do người viết, nên judge coi nó là dữ liệu chứ không phải chỉ dẫn, như với commit message.
4. PR bị đóng mà không merge thì không chấm.
5. PR merge vào nhánh khác nhánh mặc định thì không chấm riêng: công việc của nó nằm trong PR đưa nhánh đó vào nhánh mặc định, nên chấm cả hai sẽ tính trùng.

### Trạng thái trong ledger

Đơn vị đang chờ nằm trong hàng đợi (`~/.evolo/queue/`), chưa có bản ghi trong ledger.

| Trạng thái | Nghĩa | Tính vào level? |
|---|---|---|
| `scored` | Đã chấm | Có |
| `push_failed` | Push không bao giờ tới được remote | Không |
| `skipped` | Không còn commit nào để chấm: của người khác, merge commit, hoặc thuộc PR đã merge | Không |
| `superseded` | Commit cuối của đơn vị không còn trên nhánh mặc định (force-push viết lại lịch sử) | Không, XP về 0 |
| `reverted` | Mọi commit của đơn vị, hoặc merge commit của PR, đã bị revert trên nhánh mặc định | Không, XP về 0 |
| `failed` | Judge trả lời sai sau 3 lần thử, hoặc lỗi tạm thời (mạng, `gh`, judge không chạy được) vẫn còn sau 3 lần thử lại với backoff 1, 5, 30 phút | Không, `evolo retry` để chấm lại (chưa làm) |
| `needs_review` | Nghi prompt injection | Không, chờ người xem (chưa có lệnh duyệt) |

Sync kiểm tra `superseded` và `reverted` cho mọi đơn vị đang `scored` hoặc `needs_review`, so với commit hiện tại của nhánh mặc định trên remote.
Chỉ revert đã nằm trên nhánh mặc định mới được tính; revert trên một nhánh thử nghiệm thì không.
Bản ghi đổi trạng thái giữ `previousStatus` và `changedAt`, và giữ nguyên kết quả chấm ban đầu trong `result`.
Bản ghi `push_failed`, `failed` và `skipped` bị ghi đè khi đơn vị đó đến lại, ví dụ push bị từ chối được push lại sau khi sửa; bản ghi của đơn vị đã chấm thì không.
Sync không tự xếp lại PR đã có bản ghi, kể cả `failed`, để một PR lỗi không tốn tiền sau mỗi lần push.
Revert một phần (chỉ vài commit trong đơn vị) được ghi lại nhưng chưa đổi XP; cách xử lý để dành cho giai đoạn hiệu chỉnh.

### Tín hiệu XP

Tín hiệu (`docs/xp-evaluation.md` mục 7.5) là những gì GitHub biết về đơn vị sau khi nó tới nơi: CI, review, issue được đóng.
Chúng không qua AI, và nâng XP qua `M_signals`: CI pass ngay +5%, merge sạch sau review +5%, đóng issue `bug` +10%.

- Worker đọc tín hiệu ngay khi chấm xong, trước khi ghi bản ghi và gửi thông báo, nên PR đã merge (CI đã chạy xong) có đủ XP ngay.
- CI của một push thường chạy sau khi chấm, nên mỗi lần sync đọc lại tín hiệu của các đơn vị đang `scored` hoặc `needs_review` mà tín hiệu chưa chốt, rồi tính lại XP từ điểm rubric đã lưu, không gọi lại judge.
- Tín hiệu chốt (`signals.final`) khi CI của commit cuối đã xong (`SUCCESS`, `FAILURE`, `ERROR`), hoặc 24 giờ sau khi chấm; repo không có CI thì chốt sau 24 giờ, không có điểm cộng CI.
  Đã chốt thì không đọc lại, nên mỗi đơn vị tốn vài lời gọi `gh` trong ngày đầu rồi thôi.
- Mỗi lần đọc là một truy vấn GraphQL (trạng thái CI của mọi commit, và với PR thêm review, ngày commit, issue liên kết), cộng hai lời gọi REST cho mỗi issue mà commit của push nhắc tới.
- GitHub không trả lời được thì tín hiệu để đó cho lần sync sau; lỗi chỉ ghi vào `evolo.log`, không làm hỏng việc chấm.
  Quá 24 giờ mà vẫn không đọc được thì tín hiệu đã có được chốt (kèm `unreadable`), để không hỏi lại GitHub ở mọi lần sync.
  Issue không tồn tại hoặc đã bị xoá (HTTP 404, 410) thì bị bỏ qua.
- XP tăng vì tín hiệu không có thông báo; `sync` in `<repo> <id>: signals, 95 -> 100 XP`, và `why` có dòng `signals:`.
- Bản ghi giữ `signals: { ciFirstPass, cleanMerge, closesBugIssue, ci, bugIssues, final, checkedAt }`; `result.breakdown.mSignals` và `xp` là giá trị sau tín hiệu.

Kiểm chứng với `gh` thật (2026-10-20): `hiinguyen/Evolo` chưa có CI nên `ci` là `null`; commit của `cli/cli` có `SUCCESS`; review của PR `cli/cli#14750` gồm cả review của bot Copilot; issue đóng bằng PR có `commit_id` rỗng, còn issue của `golang/go` đóng bằng commit có `commit_id` khớp đúng `closer` của GraphQL.

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
- `EVOLO_JUDGE=1` là chốt an toàn chống đệ quy: dù judge không có quyền push, hook `pre-push` vẫn bỏ qua mọi lần push chạy dưới biến này.

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

## 6. Xem kết quả

Mọi cách xem đều chỉ đọc ledger và `~/.evolo/summary.json`, không gọi judge.
Điểm chỉ đến người dùng, không vào context của agent đang code (mục 1).

### `evolo status`

In hàng đợi (kèm lỗi của job đang thử lại, hoặc job chờ sang ngày vì hết ngân sách), chi phí judge hôm nay so với trần, level, tổng XP, XP hôm nay và 7 ngày gần nhất, số đơn vị `failed`, và 15 đơn vị gần nhất:

```
queue: empty
judge spending today $0.12 of $5.00
level 2  160 XP  (20 XP to level 3)
today +160 XP  last 7 days +160 XP
latest:
  2026-10-19 10:23  hiinguyen/lightrag pr-5  160 XP  Added secret-authenticated n8n AI Agent endpoints ...
```

Tổng XP tính trên cả ledger, kể cả repo đã `uninstall`, vì gỡ hook không xoá XP đã kiếm.
"Hôm nay" theo múi giờ máy, tính theo ngày đơn vị **tới nơi** (`landedAt`), không phải ngày được chấm: push là lúc hook ghi job, PR là `mergedAt` trên GitHub.
Nhờ vậy PR merge tối qua mà sáng nay mới sync, hay push phải chờ sang ngày vì hết ngân sách, vẫn tính vào đúng ngày làm.
Bản ghi chấm trước khi có `landedAt` dùng ngày commit cuối.
Nhật ký chi tiết của hook và worker nằm ở `~/.evolo/evolo.log`.

### `evolo stats`

`evolo stats [week|month|quarter] [--previous]` in analytics của một kỳ theo lịch, so với kỳ trước: XP, cơ cấu loại việc, trung bình rubric, kỷ luật test, revert, repo, thư mục, nhịp làm việc, và streak ngày làm việc.
Định nghĩa từng chỉ số: `docs/superpowers/specs/2026-10-20-evolo-stats-design.md`.
Kỳ có achievement mở thì thêm dòng `unlocked` liệt kê các bậc đó.

### `evolo achievements`

`evolo achievements` in mọi achievement theo thứ tự danh sách: bậc đã đạt (số La Mã, `-` khi chưa đạt), tiến độ tới bậc kế (`12/50`, hoặc `5 (max)` ở bậc cuối) và mô tả.
Sau đó là các achievement ẩn đã mở, rồi số achievement ẩn còn khoá (`??? × 9`); achievement ẩn còn khoá không lộ tên hay điều kiện.
Achievement tính lại từ ledger mỗi lần, nên mất khi đơn vị giữ nó bị revert hay bị force-push thay thế.
Luật và ngưỡng của achievement hiện: `docs/superpowers/specs/2026-10-20-evolo-achievements-design.md`.

### Thông báo desktop

Worker gửi `notify-send` khi một đơn vị được chấm xong:

| Trạng thái | Tiêu đề | Nội dung |
|---|---|---|
| `scored` | `Evolo +160 XP`, thêm `· level 3!` khi lên level | `lightrag PR #5: feature` và lời tóm tắt của judge |
| `needs_review` | `Evolo Needs review` | Đơn vị, và gợi ý `evolo why <id>` |
| `failed` | `Evolo Scoring failed` | Lý do, và gợi ý `evolo retry` |
| Mở achievement | `Evolo achievement unlocked: Bug Hunter II`, hoặc `Evolo 3 achievements unlocked` | Mô tả, hoặc mỗi bậc một dòng; gửi sau thông báo XP |
| Hết ngân sách ngày | `Evolo Daily budget spent` | Số tiền đã tiêu, và gợi ý `evolo config set budget.daily-usd <USD>`; mỗi ngày một lần |

`push_failed` và `skipped` không có thông báo, vì người dùng đã thấy push lỗi, còn đơn vị bị bỏ qua thì không có gì để báo.
Không có `notify-send` (máy không có desktop) thì bỏ qua, kết quả vẫn ở log và ledger.
Trình hiện thông báo báo có `body-markup` (hỏi qua `gdbus`) thì tên đơn vị được in đậm, và chữ của judge giữ lại `<b>`, `<i>`, `<u>` và `<a href>` tới địa chỉ `http(s)`, mỗi link kèm địa chỉ trong ngoặc; mọi thẻ khác (kể cả `<img>`) bị thoát, ký tự điều khiển bị bỏ (`src/safe-text.mjs`).
Không có `body-markup` thì bỏ các thẻ đó, link thành `chữ (địa chỉ)`.
SwayNotificationCenter 0.12.6 render `<b>`, `<i>`, `<u>` nhưng hiện thẻ `<a>` nguyên văn (2026-10-20).
Đơn vị bị `reverted` hay `superseded` khi sync chưa có thông báo; `status` vẫn hiện chúng.
Achievement chỉ được kiểm tra sau một bản ghi `scored`; `~/.evolo/achievements.json` nhớ các bậc đã báo để không báo lại bậc mất rồi mở lại.
Lần chấm đầu tiên sau khi cập nhật báo gộp mọi bậc ledger đã đạt.

### `evolo why [<commit>|#<pr>|<unit id>]`

Giải thích một lần chấm: commit và file, lời tóm tắt, từng điểm rubric kèm lý do và bằng chứng, các cảnh báo của validator, các commit bị bỏ, và dòng công thức:

```
XP = 60 base (feature) × 2.24 value × 1.5 size (934 lines) × 0.8 repo × 1 signals = 161.55 -> 160  [formula 1.2]
signals: none
```

Dòng `signals:` liệt kê tín hiệu đã cộng (`CI passed the first time +5%, closes bug issue #12 +10%`), và khi chưa chốt thì thêm `read again at the next sync (CI: pending)`.

Không có tham số thì giải thích đơn vị mới nhất.
Trong một clone đã đăng ký, chỉ tìm trong repo đó, và tham số có thể là bất kỳ tên commit nào git hiểu (`HEAD~2`, SHA rút gọn).
Một commit thuộc nhiều đơn vị (push bỏ nó vì nó thuộc PR) thì `why` chọn đơn vị đã tính nó.

### `evolo retry`

Cho các job đang chờ thử lại chạy ngay, và xếp lại hàng đợi mọi đơn vị `failed` của repo đã đăng ký.
Job xếp lại biết push đã xong từ lâu: commit không còn trên remote (đã bị force-push) thì thành `push_failed` ngay, không chờ 10 phút.
Kết quả mới thay bản ghi `failed` vì cùng mã đơn vị.

### Status line và tích hợp Claude Code

`evolo claude install` cài ba thứ cho mọi repo, `evolo claude uninstall` gỡ cả ba:

- **Skill `/evolo`:** symlink `~/.claude/skills/evolo` tới `packages/cli/claude/skills/evolo`.
  `/evolo` tóm tắt `status`, `/evolo why <ref>` giải thích, `/evolo retry` chấm lại.
  Skill có `disable-model-invocation`, nên chỉ chạy khi người dùng gõ, và chỉ được chạy `evolo status`, `why`, `retry`.
  Nó không tự chấm, nên kết quả luôn đến từ cùng một judge.
- **Hook `SessionStart`:** chạy `evolo sync --background`, để lại yêu cầu sync (`~/.evolo/sync-requested`), khởi động worker tách rời rồi thoát, không in gì.
  Worker sync trước rồi chấm những gì sync xếp hàng, nên PR merge trên GitHub được chấm ngay khi mở phiên mới.
  Một worker đang ngủ chờ thử lại cũng thấy yêu cầu và sync, vì worker mới không lấy được lock.
  Không in gì là bắt buộc: Claude Code đưa stdout của hook `SessionStart` vào context của agent.
- **Status line:** `evolo statusline` in `Lv 7 · 1,245 XP · +105 today · 1 queued`.
  Nó chỉ đọc `summary.json` (XP theo ngày, ghi lại mỗi khi ledger đổi) và đếm hàng đợi; mất khoảng 50 ms, gần hết là thời gian khởi động Node.
  `install` chỉ đặt status line khi người dùng chưa có; đã có (ví dụ của Orca) thì giữ nguyên và nhắc tự thêm output của `evolo statusline` vào.

Lệnh `install` chạy lại được: nó thay mục của Evolo trong `settings.json` thay vì thêm mục mới, và sửa đúng file mà `settings.json` trỏ tới khi nó là symlink.
`settings.json` không phải JSON hợp lệ thì lệnh dừng, không ghi đè.

### Chưa làm

- `evolo backfill 30d`: chấm bù các lần push và PR cũ; cách tìm lại các lần push cũ cần chốt trước (`docs/handoff.md` mục 9).
- `evolo preview`: chấm thử các commit chưa push, không ghi vào ledger.
- Duyệt `needs_review` (chấp nhận hoặc bỏ điểm); hiện chỉ xem được bằng `why`.

## 7. Độ bền

| Tình huống | Xử lý |
|---|---|
| Push liên tục nhiều lần | Tất cả vào hàng đợi, 1 worker chấm lần lượt theo thứ tự push |
| Push bị remote từ chối | `git push` kết thúc mà remote không có commit: `push_failed` ngay, không gọi judge |
| Mất mạng, `gh` chưa đăng nhập | Job ở lại hàng đợi, thử lại sau 1, 5, 30 phút rồi thành `failed`; `evolo status` hiện lý do. Mọi lời gọi `gh`, `ls-remote` và `fetch` có timeout 2 phút |
| `claude` chưa đăng nhập, mất mạng, API quá tải hoặc hết hạn mức | Judge không trả lời được (`JudgeUnavailableError`): job ở lại hàng đợi như trên, không ghi gì vào ledger |
| Judge trả lời sai schema hoặc thiếu bằng chứng | `evaluate.mjs` thử 3 lần; vẫn sai thì `failed` |
| Máy tắt khi đang chấm | Lock chứa PID và được làm mới mỗi 30 giây. Lock của PID đã chết, hoặc không được làm mới trong 5 phút (PID bị tái sử dụng sau khi khởi động lại), bị gỡ. Job chỉ bị xoá sau khi bản ghi ledger đã được ghi, nên job đang chấm dở được chấm lại |
| Job thêm vào đúng lúc worker sắp thoát | Worker nhả lock rồi xem lại hàng đợi một lần nữa, nên job không bị bỏ quên |
| Job đang chờ thử lại | Worker ngủ tối đa 5 giây mỗi lần rồi xem lại hàng đợi, nên push mới không phải chờ |
| Force-push qua mạng chậm | Worker sync sau khi đã chấm xong và không còn job nào mới hay đang chờ push tới nơi, nên đơn vị bị thay luôn thành `superseded` |
| Hai worker cùng thấy lock cũ | Mỗi worker chỉ xoá lock khi nó vẫn chứa đúng PID đã đọc, và chỉ nhả lock của chính mình |
| Judge treo | Timeout 20 phút cho mỗi lần thử, giết tiến trình con (`judges/common.mjs`) |
| Chi phí tăng vọt | `--max-budget-usd 1` cho mỗi lần chấm, và trần theo ngày `budget.daily-usd` (mặc định $5): hết ngân sách thì đơn vị cần judge chờ sang ngày sau, đơn vị triage bằng luật vẫn được chấm |
| Repo bị xoá hoặc di chuyển | Worker bỏ các job của repo đó và ghi lý do vào `evolo.log`; sync báo đường dẫn không còn tồn tại |

Trần theo ngày:

- `evolo config set budget.daily-usd 2.50` đổi trần; nhận số dương, tối đa hai chữ số thập phân.
  Giá trị sửa tay sai trong `config.json` thì dùng mặc định và ghi vào `evolo.log`, không làm hỏng đơn vị nào.
- Số đã tiêu là tổng `costUsd` của các bản ghi ledger (kể cả `failed`) và các review đã lưu có thời điểm trong ngày theo múi giờ máy, nên không có bộ đếm riêng phải giữ cho khớp.
  `evolo review` và `evolo evaluate` không bị chặn, vì người dùng tự gọi, nhưng chi phí của `review` được tính vào ngày.
- Trần được kiểm tra trước khi gọi judge cho một đơn vị, không kiểm tra giữa chừng: đơn vị bắt đầu dưới trần thì chạy hết, nên một ngày có thể vượt trần tối đa một đơn vị (mỗi lần thử dừng ở $1, tối đa 3 lần thử).
- Đơn vị bị chặn thì ở lại hàng đợi với `budgetDay` là hôm nay và `notBefore` là nửa đêm; nó không chặn sync, và worker thoát thay vì thức chờ đến sáng.
  Worker đầu tiên của ngày hôm sau (push mới, hoặc hook `SessionStart`) chấm nó; không có gì tự khởi động worker lúc nửa đêm.
  Nâng trần bằng `evolo config set budget.daily-usd` thì lệnh khởi động worker, và worker cho các đơn vị đang chờ chạy ngay khi chi phí hôm nay đã dưới trần mới.
- Chi phí của lần thử bị lỗi sau khi judge đã chạy (ví dụ dừng ở `--max-budget-usd`) giờ được cộng vào `costUsd`.
  Một đơn vị `failed` được `retry` thay bản ghi cũ, nên chi phí của lần thất bại trước không còn được đếm.

Hàng đợi và ledger là các file JSON, mỗi job hoặc đơn vị một file, ghi theo kiểu atomic (ghi file tạm rồi `rename`).
Nhờ vậy không cần database, không bao giờ đọc phải file ghi dở, và dễ debug bằng `cat`.

Giới hạn đã biết:
- Lần push đầu của nhánh mặc định chấm cả lịch sử thành một đơn vị (hệ số kích thước có trần, nên XP không tăng vô hạn).
- Hook gọi `node` theo đường dẫn lúc `init`; đổi bản Node (nvm) thì hook im lặng không chạy, cần `evolo init` lại.
- Với `core.hooksPath` dùng chung cho nhiều repo, `uninstall` ở một repo gỡ hook của tất cả; husky có thể sinh lại thư mục hook và xoá hook của Evolo.
- Lock dựa trên file: hai worker cùng gỡ một lock cũ trong cùng vài micro giây vẫn có thể cùng chạy.

## 8. Bảo mật và quyền riêng tư

- Diff và code được gửi lên Claude qua tài khoản của chính bạn, giống như khi bạn code bằng Claude.
  Repo nào không muốn gửi thì không chạy `evolo init` ở đó, hoặc gỡ bằng `evolo uninstall`.
- Ledger chỉ lưu facts, điểm, lý do và đường dẫn bằng chứng, không lưu code.
- Judge không ghi được file, không có mạng (vì không có WebFetch), không có MCP và không đọc settings của người dùng.
- Repo được chấm có thể chứa nội dung cố tình nhắm vào giám khảo.
  Các quy tắc tin cậy và cờ `suspected_injection` trong `xp-judge.md` vẫn áp dụng, và đơn vị bị gắn cờ sẽ ở trạng thái `needs_review`.
- Evolo hiện chỉ dùng cá nhân nên không có cơ chế chống gian lận; ledger là file trên máy người dùng.

## 9. Cấu trúc code

```
packages/cli/                 # gói npm "evolo"
  bin/evolo.mjs               # [có] init, uninstall, enqueue, worker, sync, status, why, retry, statusline, claude, evaluate | [chưa] backfill, preview
  src/evaluate.mjs            # [có] facts → triage → worktree → judge → validate → xp cho một change set
  src/facts.mjs               # [có] số liệu diff ròng base..tip, danh sách commit, revert, thông tin PR
  src/score.mjs               # [có] triage, validator, công thức XP 1.2, levelFor
  src/judges/common.mjs       # [có] READ_ONLY_COMMANDS, chạy tiến trình JSONL, timeout, dọn tiến trình con
  src/judges/claude.mjs       # [có] backend claude -p (mục 5), mặc định
  src/judges/opencode.mjs     # [có] backend opencode, sinh file agent tạm từ judge/xp-judge.md
  src/hooks.mjs               # [có] cài và gỡ hook pre-push, tôn trọng core.hooksPath, chain hook cũ
  src/queue.mjs               # [có] hàng đợi file, lock có PID và heartbeat, khởi động worker tách rời
  src/worker.mjs              # [có] enqueue, xác nhận push, chấm, thử lại, sync PR, thông báo, retry
  src/repos.mjs               # [có] repos.json, init, uninstall
  src/store.mjs               # [có] ~/.evolo, ghi JSON atomic, log
  src/units.mjs               # [có] dải push, lần push của hook (cả force-push), commit đơn, PR thành change set; chọn commit của push
  src/github.mjs              # [có] mọi lời gọi gh: đọc PR, PR chứa một commit, PR đã merge của tôi, chọn remote đúng, CI, review, issue
  src/signals.mjs             # [có] tín hiệu XP (CI, merge sạch, issue bug) và tính lại XP từ điểm đã lưu
  src/budget.mjs              # [có] chi phí judge theo ngày và trần budget.daily-usd
  src/config.mjs              # [có] ~/.evolo/config.json: review.language, budget.daily-usd
  src/ledger.mjs              # [có] bản ghi, trạng thái, superseded và reverted khi sync, landedAt, summary.json
  src/stats.mjs               # [có] analytics theo kỳ và streak, cho evolo stats
  src/achievements.mjs        # [có] bậc, tiến độ và ngày mở của achievement; achievements.json nhớ bậc đã báo
  src/achievements/           # [có] catalog.mjs (achievement hiện), secret.mjs (achievement ẩn), fixtures.mjs (bản ghi giả cho test)
  src/views.mjs               # [có] nội dung thông báo, status line, why, stats, achievements; tìm đơn vị theo commit, PR hoặc mã
  src/claude.mjs              # [có] claude install/uninstall: skill, hook SessionStart, status line
  fakes/                      # [có] gh, claude, notify-send và gdbus giả cho test E2E (sandbox.mjs)
  judge/xp-judge.md           # [có] rubric và prompt: một nguồn duy nhất cho cả hai backend
  judge/output.schema.json    # [có] schema đầu ra, có test kiểm tra khớp với validator
  claude/skills/evolo/SKILL.md  # [có] skill /evolo
```

Chạy test: `cd packages/cli && npm test`.
Cài lệnh `evolo` một lần: `ln -s "$PWD/packages/cli/bin/evolo.mjs" ~/.local/bin/evolo` (hoặc `npm link` trong `packages/cli` nếu thư mục global của npm ghi được không cần sudo).
Cài cho một repo: `evolo init` trong clone đó; xem kết quả bằng `evolo status`.
Chấm thử: `evolo evaluate --repo <clone> --out <dir> --own [--judge opencode] [--model M] [--range <from>..<to>]... [--pr <number>]... [<sha>...]`.

## 10. Lộ trình

1. **Judge Claude:** xong, Sonnet là mặc định (mục 5).
2. **Change set và PR:** xong (2026-10-18), xem `docs/handoff.md` mục 3.
3. **Hook, hàng đợi, sync:** xong (2026-10-19): `init`, `uninstall`, `enqueue`, `worker`, `sync`, `status`, kèm test E2E trên một repo tạm có remote giả (bare repo).
   Test này push thành công, push bị từ chối, force-push, merge PR (qua `gh` giả lập), revert, rồi kiểm tra trạng thái trong ledger.
4. **Hiển thị:** xong (2026-10-19) `status`, thông báo desktop, `why`, `retry`, `statusline`, skill `/evolo` và hook `SessionStart` chạy `evolo sync --background`; còn `backfill` và `preview`.

Hiệu chỉnh bằng golden set và các phần game hoá nằm trong lộ trình chung ở `docs/architecture.md` mục 11.

## 11. Câu hỏi mở

- Có chấm cả repo của tổ chức hay công ty không?
  Nếu có thì cần tuỳ chọn tắt gửi code theo từng remote, vì chính sách công ty có thể không cho phép.
- Thông báo desktop có làm phiền không?
  Có thể chỉ hiện trong status line.
