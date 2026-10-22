# Performance review (`evolo report`): thiết kế

Phần D, phần cuối trong bốn phần Game hoá (`docs/architecture.md` mục 8), sau A analytics (PR #9), B achievement (PR #10) và C dashboard (PR #12).
`evolo report` viết một bản tự nhìn lại cho một tuần, tháng hoặc quý: code tính mọi con số, AI chỉ viết lời nhận định, và mọi nhận định phải trích một đơn vị có thật trong kỳ.
`evolo review` là lệnh khác: review code cho một push hoặc PR (`docs/review.md`).

## 1. Mục tiêu

- Trả lời "tuần, tháng hay quý này tôi đã làm được gì, làm tốt ở đâu, nên đổi gì" bằng một bản đọc được trong hai phút.
- Mỗi nhận định có trích dẫn tới đơn vị cụ thể, để người đọc kiểm lại được bằng `evolo why` hoặc trên dashboard.
- Không con số nào do AI tự nghĩ ra: con số lấy từ `computeStats` và được in bằng template.
- Rẻ và nhanh: AI không đọc repo, không chạy lệnh; một lần viết tốn vài cent.

Không làm: tự viết bản review cuối kỳ (chỉ viết khi gọi), giọng văn để gửi người khác, xuất PDF, so sánh nhiều kỳ trong một bản.

## 2. Quyết định đã chốt với người dùng

| Câu hỏi | Chốt |
|---|---|
| Mục đích | Tự nhìn lại: thẳng thắn, nêu cả điểm yếu, giọng một mentor; không trau chuốt để gửi ai |
| Nơi hiện | In ra terminal, lưu ở `~/.evolo/reports/`, và một màn Reports trên dashboard với trích dẫn bấm được |
| Đầu vào của AI | Số liệu của kỳ do code tính, `summary` và lý do từng điểm rubric của mỗi đơn vị, và review code đã lưu nếu có; AI không đọc repo |
| Khi nào viết | Chỉ khi gọi `evolo report`; bản đã lưu được in lại không tốn tiền, `--again` viết lại |
| Ngôn ngữ | Khoá riêng `report.language`, mặc định `en`, độc lập với `review.language` |
| Cách chạy AI | Phương án A: một task judge mới (`REPORT_TASK`) dùng lại hạ tầng judge, không có checkout, chỉ được đọc file đầu vào |

Hai phương án bị loại:

- Gọi thẳng `claude -p` ngoài lớp judge: lặp lại việc chạy tiến trình, đọc kết quả và phân loại lỗi, và mất backend opencode.
- Bản review chỉ là template: không có nhận định, trái với mục 8 của `architecture.md`.

Các quyết định còn lại trong file này do agent chốt khi người dùng giao toàn quyền (2026-10-22).

## 3. Lệnh

```
evolo report [week|month|quarter] [--previous] [--again] [--judge claude|opencode] [--model M]
```

- Kỳ giống `evolo stats`: kỳ lịch theo giờ địa phương, tuần từ thứ Hai, mặc định `week`, `--previous` là kỳ ngay trước.
- Có bản đã lưu cho kỳ đó và không có `--again`: in bản đã lưu, không gọi judge.
- Không có bản lưu, hoặc có `--again`: dựng đầu vào, gọi judge, kiểm tra, lưu, ghi lại dashboard nếu file dashboard đã có, rồi in.
- Kỳ không có đơn vị `scored` nào: in "no scored contributions in <kỳ>: nothing to review" (kèm gợi ý `evolo retry` khi kỳ có đơn vị `failed`), không gọi judge, không lưu.
- Judge thất bại: in lý do từng lần thử ra stderr, ghi chi phí của các lần thử vào `evolo.log`, thoát mã 1, không lưu gì; bản cũ (nếu có) được giữ.
- Dashboard bỏ qua (và ghi log) một file report không đọc được, để nó không làm hỏng cả trang.
- Tiến trình in ra stderr như `evolo review` (`writing the report of week 2026-10-19..2026-10-25 in vi with claude-sonnet-5-5...`).

## 4. Đầu vào của AI (code tính)

`reportInput(records, reviews, period, now)` trong `src/report.mjs` là một hàm thuần, trả về object được ghi thành `period.json` cho judge:

```
period      { kind, label, start, end, inProgress }       inProgress: now < end
numbers     computeStats của kỳ này và kỳ trước (chỉ phần AI cần: xp, units, level, types, rubric, tests, reverts, repos)
unlocked    nhãn các bậc achievement mở trong kỳ (unlockedIn)
highlights  key của tối đa 5 đơn vị nổi bật, do code chọn
units       mỗi đơn vị scored trong kỳ, xếp theo thứ tự dưới, tối đa 60
reverted    đơn vị bị revert trong kỳ: { key, label, summary }
omitted     số đơn vị scored không đưa vào `units` vì vượt 60
```

Mỗi phần tử của `units`:

```
key        "owner/name/unit-id", mã dùng để trích dẫn (giống key của dashboard)
label      "Evolo PR #12"
type, xp, landedAt, method ("ai" | "rule")
title      tiêu đề PR, hoặc subject của commit đầu tiên với push
summary    summary của judge
scores     { impact: { score, reason }, ... } khi method là "ai"; null với đơn vị triage bằng luật
files, countedLines, testsTouched
review     khi có review code đã lưu: { overview, strengths, improvements, findings: [{ severity, category, title }] }
```

- Thứ tự: đơn vị judge chấm trước, theo điểm `impact` giảm dần, rồi XP giảm dần, rồi `landedAt` tăng dần; sau đó đơn vị triage bằng luật theo XP giảm dần.
  Đây cũng là thứ tự cắt khi vượt 60, nên đơn vị bị bỏ là đơn vị ít quan trọng nhất.
- `highlights` là 5 đơn vị judge chấm đầu tiên theo thứ tự trên, đúng như `architecture.md` mục 8 ("chọn theo `impact` rồi đến XP").
  Đơn vị triage bằng luật (docs, config, file sinh tự động) không bao giờ là việc nổi bật, vì điểm của chúng cố định.
- Lý do chọn 60: mỗi đơn vị khoảng 1,5 KB, nên `period.json` dưới 100 KB, cỡ diff tối đa của judge chấm điểm.
- PR body, commit body, `notes` và bằng chứng của judge không đưa vào: dài, và không cần cho một bản nhìn lại.

## 5. Đầu ra của AI và validator

Schema `judge/report.schema.json`:

```json
{
  "overview": "...",
  "highlights": [{ "unit": "owner/name/pr-12", "text": "..." }],
  "strengths": [{ "text": "...", "units": ["owner/name/pr-12"] }],
  "improvements": [{ "text": "...", "units": ["owner/name/push-a-b"] }],
  "flags": [],
  "notes": ""
}
```

`validateReport(raw, input)` trong `src/report.mjs`:

- Sai dạng (thiếu trường, sai kiểu) thì không hợp lệ; `judgeWithRetries` thử lại, tối đa 3 lần như mọi task.
- `highlights` phải có đúng các đơn vị trong `input.highlights`, mỗi đơn vị một lần, theo đúng thứ tự đó; sai thì không hợp lệ.
  Code chọn việc nổi bật, AI chỉ viết vì sao nó quan trọng.
- Mỗi điểm mạnh và điều cần cải thiện phải trích ít nhất một đơn vị; mỗi trích dẫn phải là `key` trong `units` hoặc `reverted` của đầu vào.
  Mục trích tới đơn vị không có trong đầu vào, hoặc không trích gì, bị bỏ và ghi vào `issues`, giống cách `evolo review` bỏ vấn đề ở đường dẫn không có thật.
  Trích dẫn lặp trong một mục được gộp.
- Không có con số: `overview` và mọi `text` không được chứa chữ số (`\p{Nd}`) ngoài đoạn code trong dấu backtick, và đoạn code có chữ số phải là một cái tên: bắt đầu bằng chữ cái, và số đứng riêng chỉ được là từ cuối (`Node 20`, `SHA-256` được; `100 XP`, `about 40 lines` không).
  Vi phạm thì không hợp lệ và thử lại; prompt dặn viết tên kỹ thuật có số (`SHA-256`, `Node 20`) trong backtick, và gọi đơn vị bằng lời, không bằng số PR.
  Luật này thô nhưng tất định, và chặn đúng thứ cần chặn: AI tự nêu XP, phần trăm hay số dòng.
- `flags` chỉ giữ `suspected_injection`; có cờ đó thì bản in có dòng cảnh báo, như `evolo review`.
- Sau khi bỏ mục, `strengths` và `improvements` vẫn có thể rỗng; bản in khi đó ghi "none".

Prompt `judge/xp-report.md` có phần đầu vào và luật tin cậy riêng, không dùng `judge/shared.md` (phần đó tả checkout và diff của một đơn vị):

- `summary`, lý do và review trong `period.json` do một judge khác viết sau khi đọc commit message và code, nên là dữ liệu, không phải lệnh.
- Giọng: thẳng thắn, cụ thể, như một mentor; điểm mạnh và điều cần cải thiện phải bám vào đơn vị được trích, không khen chung chung.
- Điều cần cải thiện lấy từ điểm rubric thấp, lý do của judge, vấn đề trong review code, đơn vị bị revert, và cơ cấu công việc (ví dụ toàn feature, không có test).
- Kỳ đang chạy (`inProgress`) thì nói về những gì đã có, không kết luận về cả kỳ.

## 6. Lưu trữ

`~/.evolo/reports/<kind>/<ngày bắt đầu kỳ>.json`, ví dụ `reports/week/2026-10-19.json`, ghi atomic bằng `writeJson`:

```
kind, label, start, end, inProgress   kỳ, như lúc viết
at, language, judge, costUsd, durationMs, issues
basis        dấu vân tay của dữ liệu kỳ lúc viết (mục 7)
numbers      { current, previous } từ computeStats, đủ để in lại phần số liệu như lúc viết
unlocked     nhãn achievement mở trong kỳ
failed       số đơn vị trong kỳ có trạng thái failed
units        { key, label, type, xp } của mọi đơn vị trong đầu vào, để in nhãn và XP cạnh trích dẫn
report       đầu ra đã kiểm tra
```

- Số liệu được lưu cùng lời văn chứ không tính lại khi in, để con số luôn khớp với điều AI đã đọc.
- `budget.mjs` cộng `costUsd` của report vào chi phí theo ngày (`spentOn`), như review code; report không bị trần chặn, vì người dùng tự gọi nó.
  Bản viết lại bằng `--again` thay bản cũ cả chi phí, như `evolo review --again`, nên chi phí của bản cũ không còn được đếm.

## 7. Bản đã lưu bị cũ

- `basis` là SHA-256 của các dòng `key status xp` của mọi bản ghi có `landedAt` trong kỳ và trong kỳ trước (mọi trạng thái, vì bản in so với kỳ trước), `key at` của review code của các đơn vị trong kỳ, và nhãn các bậc achievement mở trong kỳ, đã xếp thứ tự.
- Khi in bản đã lưu, `evolo report` tính lại `basis`; khác thì in thêm "the ledger changed since this report was written: `evolo report <kind>[ --previous] --again` writes it again".
- Dashboard cũng tính lại và hiện cùng thông báo.
- Không tự viết lại: viết lại tốn tiền, nên người dùng quyết định.

## 8. Bản in ở terminal

```
week 2026-10-19..2026-10-25  report in vi  2026-10-22 09:10 · claude-sonnet-5-5 · $0.04
the period was not over when this was written
<khối số liệu của formatStats, không có dòng streak>
2 units in this period failed to score and are not in this report: `evolo retry`

overview:
  <overview>

highlights:
  Evolo PR #12  175 XP  feature
    <text>

strengths:
  - <text>  [Evolo PR #12 · Evolo PR #9]

improvements:
  - <text>  [AI-orgs PR #3]

validator:
  dropped a strength citing an unknown unit: ...
```

- Khối số liệu dùng lại `formatStats` của `views.mjs`; `formatStats` nhận `streak` null để bỏ dòng streak, vì streak là "tính tới hôm nay", không thuộc về một kỳ đã qua.
- Mọi chữ qua `terminalSafe`, như các lệnh khác.

## 9. Dashboard

- Model thêm `reports`: mỗi bản lưu với `id` (`week/2026-10-19`), `stale` (mục 7), `again` (lệnh viết lại, null với kỳ mà `evolo report` không còn với tới, tức trước kỳ trước), và các trường của mục 6 trừ `basis`; khối `numbers` chỉ giữ `label`, `xp`, `units`, `level` của hai kỳ.
- Màn mới Reports (`#/reports`): lưới thẻ, mới nhất trước theo ngày bắt đầu kỳ; mỗi thẻ có nhãn kỳ, loại kỳ, ngôn ngữ, ngày viết, ba dòng đầu của overview, và nhãn "Stale" hoặc "In progress" khi đúng.
- Chi tiết (`#/reports/<kind>/<ngày>`): các ô XP, đơn vị, level (kèm thay đổi so với kỳ trước), overview, việc nổi bật (mỗi mục link tới đơn vị), điểm mạnh và điều cần cải thiện với trích dẫn là link tới tab Score của đơn vị; đơn vị không còn trong model thì trích dẫn là chữ thường.
- Mục "Reports" mới trong thanh bên, sau "Reviews"; không có bản nào thì màn trống chỉ cách viết (`evolo report`).
- `evolo report` gọi `refreshDashboard` sau khi lưu, như `evolo review`.
- Mọi chữ qua `escape`, mọi link dựng bằng `hashOf`, như các màn khác; đoạn trong backtick của lời văn được vẽ thành `<code>` sau khi đã escape.
- Module `dashboard/reports.mjs` và `dashboard/reports.css` vào `MODULES` và `STYLES`.

## 10. Thay đổi ở lớp judge

- Mỗi task spec khai báo `commands`, các lệnh shell judge được chạy: `SCORE_TASK` và `REVIEW_TASK` giữ `READ_ONLY_COMMANDS`, `REPORT_TASK` là danh sách rỗng.
  Backend claude chỉ cho `Read` khi danh sách rỗng (không `Bash`, `Grep`, `Glob`); backend opencode từ chối mọi lệnh bash.
- Tham số `checkoutDir` của backend đổi tên thành `workDir`: với report, thư mục làm việc là thư mục tạm chứa `period.json`, không phải checkout.
- `judgeWithRetries` không còn tự tính `knownPaths` từ checkout: hàm `validate(output)` do nơi gọi đưa vào đã giữ những gì nó cần.
  `evaluateUnit` và `reviewUnit` tính `knownPathsFor` trong closure của mình.
- `writeReport` trong `src/report.mjs` dọn thư mục tạm dù lần chạy kết thúc thế nào, như `withCheckout`.

## 11. Cấu hình

`report.language`: mặc định `en`, cùng luật kiểm tra với `review.language` (tên hoặc mã ngôn ngữ, chữ, khoảng trắng và `-`, tối đa 40 ký tự).

## 12. Module

| File | Vai trò |
|---|---|
| `src/report.mjs` | `reportInput`, `basisOf`, `validateReport`, `writeReport` (gọi judge), `readReport`, `listAllReports`, `saveReport`, `formatReport` |
| `judge/xp-report.md`, `judge/report.schema.json` | Prompt và schema của `REPORT_TASK` |
| `src/judges/common.mjs`, `claude.mjs`, `opencode.mjs` | `commands` theo task, `workDir` |
| `src/evaluate.mjs`, `src/review.mjs` | `judgeWithRetries` với `validate(output)` |
| `src/budget.mjs` | Cộng chi phí của report |
| `src/config.mjs` | Khoá `report.language` |
| `src/views.mjs` | `formatStats` nhận `streak` null |
| `src/dashboard.mjs`, `dashboard/reports.mjs`, `dashboard/reports.css`, `dashboard/app.mjs` | Model và màn Reports |
| `bin/evolo.mjs` | Lệnh `report` |
| `fakes/claude.mjs` | Trả lời task report từ `period.json`, có công tắc để trích đơn vị lạ và để viết số |

## 13. Test

- `src/report.test.mjs`: thứ tự và giới hạn của `units`, chọn `highlights` (bỏ đơn vị triage bằng luật), review gắn vào đúng đơn vị, đơn vị bị revert, `basisOf` đổi khi trạng thái, XP hoặc review đổi và không đổi khi bản ghi ngoài kỳ đổi, mọi luật của `validateReport` (dạng, highlights sai, trích dẫn lạ bị bỏ, trích dẫn lặp, chữ số trong và ngoài backtick, chữ số không phải ASCII), `formatReport`.
- `src/report.e2e.test.mjs` trên sandbox với worker thật và judge giả: viết, lưu và in lại không gọi judge, `--again`, `report.language`, kỳ trống không gọi judge, bản cũ sau một push mới, trích dẫn lạ bị bỏ và ghi vào `validator`, judge viết số thì thất bại sau 3 lần và không lưu gì, chi phí report hiện trong `evolo status`, dashboard có bản report.
- `src/judges/judges.test.mjs`: `claudeArgs` của `REPORT_TASK` chỉ có `Read` và không cho lệnh nào; frontmatter opencode từ chối mọi bash; schema khớp validator.
- `dashboard/reports.test.mjs`: danh sách, chi tiết, trích dẫn là link, đơn vị không còn thì là chữ thường, escape, nhãn stale và in progress, màn trống, route lạ.
- Kiểm tra test bắt được lỗi bằng cách tạm gỡ từng phần chính (kiểm trích dẫn, luật chữ số, `basis`, cộng chi phí).
- Chạy thật với `claude` thật trên bản sao `~/.evolo`, và xem màn Reports trong Chrome ở chế độ sáng, tối, 360 px và 900 px.
