# Analytics (`evolo stats`): thiết kế

Phần A trong bốn phần Game hoá (`docs/architecture.md` mục 6-9), làm theo thứ tự A analytics, B achievement, C dashboard, D performance review.
Mỗi phần có spec, plan và PR riêng; B, C và D dùng lại `src/stats.mjs` của phần này.

## 1. Mục tiêu

- Trả lời câu hỏi "cách tôi làm việc thay đổi thế nào" bằng số liệu tính tất định từ ledger, không gọi AI.
- `src/stats.mjs` là hàm thuần trên các bản ghi, để dashboard, achievement và report dùng lại.
- Lệnh `evolo stats [week|month|quarter] [--previous]` in số liệu của một kỳ, so với kỳ ngay trước nó.

Không làm: cache số liệu, xuất JSON, tuỳ chọn múi giờ hay ngày đầu tuần, chi phí review trong số liệu, achievement.

## 2. Ngày của một đơn vị: `landedAt`

Hiện XP theo ngày dùng `at`, là lúc chấm xong.
PR merge tối qua mà sáng nay mới sync, hoặc push phải chờ sang ngày vì hết ngân sách, rơi sang ngày hôm sau và làm đứt streak.

Bản ghi thêm `landedAt`, lúc đóng góp tới nơi:

- PR: `mergedAt` từ GitHub; `github.mjs` đọc thêm trường này và `units.mjs` giữ nó trong `facts.pr.mergedAt`.
- Push: `enqueuedAt` của job, tức lúc hook `pre-push` chạy, ngay trước khi push tới remote.
- `evolo retry` xếp lại một đơn vị `failed` với `landedAt` của bản ghi cũ, để lần chấm lại không đổi ngày.

`landedAt(record)` trong `ledger.mjs` là nguồn duy nhất cho ngày của một đơn vị: `record.landedAt`, nếu thiếu thì `facts.pr.mergedAt`, rồi ngày của commit cuối, rồi `at`.
Bản ghi chấm trước thay đổi này dùng được ngay, không cần migration.
`summarize` (XP theo ngày trong `summary.json`, dùng cho `status` và status line) chuyển sang `landedAt`, để mọi chỗ cùng một ngày.
Chi phí judge theo ngày (`budget.mjs`) vẫn theo `at`, vì đó là ngày tiền được tiêu.

## 3. Kỳ

Kỳ theo lịch, giờ địa phương của máy:

| Kỳ | Bắt đầu | Nhãn |
|---|---|---|
| `week` | thứ Hai 00:00 | `week 2026-10-19..2026-10-25` |
| `month` | ngày 1 | `2026-10` |
| `quarter` | ngày 1 của tháng 1, 4, 7, 10 | `2026 Q4` |

`periodOf(kind, now, back)` trả `{ kind, start, end, label }` với `end` không thuộc kỳ; `back = 1` là kỳ trước.
Một đơn vị thuộc kỳ khi `start <= landedAt < end`.

## 4. Số liệu của một kỳ

`computeStats(records, period)` chỉ dùng đơn vị `scored`, trừ độ ổn định.

| Chỉ số | Định nghĩa |
|---|---|
| Tổng | XP, số đơn vị, chi phí judge của các đơn vị đó (`result.costUsd`), level ở cuối kỳ (XP của mọi đơn vị `scored` tới trước `end`) |
| Cơ cấu | Số đơn vị và XP theo `contribution_type` |
| Xu hướng rubric | Trung bình từng tiêu chí trong `CRITERIA`, kèm số đơn vị `n`; chỉ đơn vị có `method: "ai"`, vì triage bằng luật gán điểm cố định |
| Kỷ luật test | Đơn vị có `testsTouched` trên số đơn vị có `countedLines > 0` trong repo có `repoHasTests` |
| Độ ổn định | `reverted` trên `scored + reverted`; `superseded` không tính, vì force-push không phải lỗi chất lượng |
| Repo | XP và số đơn vị theo repo, nhiều XP trước |
| Thư mục | Số dòng được tính (file `source` và `test`, thêm cộng xoá) theo thư mục cha trực tiếp của file, kèm tên repo, nhiều dòng trước |
| Nhịp làm việc | Số commit của đơn vị trong kỳ theo giờ (24 ô) và theo thứ (thứ Hai trước), giờ địa phương, theo ngày của commit |

Thư mục cha thay cho "2 cấp đầu", vì trên Evolo (monorepo) 2 cấp đầu luôn là `packages/cli`, còn thư mục cha tách được `packages/cli/src`, `bin`, `fakes`, `src/judges`.
File ở gốc repo thuộc thư mục `.`.

## 5. Streak

`streakOf(records, now)` trả `{ current, longest }`, tính trên toàn bộ lịch sử, không theo kỳ.

- Một ngày có đóng góp khi có ít nhất một đơn vị `scored` có `landedAt` trong ngày đó (giờ địa phương).
- Thứ Hai đến thứ Sáu không có đóng góp thì chuỗi đứt; thứ Bảy và Chủ nhật không có đóng góp thì chuỗi giữ nguyên, có đóng góp thì được cộng.
- Hôm nay chưa có đóng góp thì chưa làm đứt chuỗi: `current` đếm tới hôm qua.

## 6. Hiển thị

`formatStats(current, previous, streak)` trong `views.mjs` trả các dòng in ra; chữ của repo và đường dẫn đi qua `terminalSafe`.

```
week 2026-10-19..2026-10-25  (vs week 2026-10-12..2026-10-18)
535 XP  5 units  level 5  judge $0.62
streak 1 workday (longest 1)
types     feature 3 (440 XP) · bugfix 1 (75 XP) · infra 1 (20 XP)
rubric    impact 2.4  centrality 2.2  difficulty 2.4  quality 3.6  scope_fit 3.0  (n=5)
tests     4 of 4 units with code touched tests (100%)
reverted  0 of 5
repos     hiinguyen/Evolo 535 XP (5)
dirs      Evolo/packages/cli/src 1,809 · Evolo/packages/cli/bin 155 · Evolo/packages/cli/src/judges 80 · Evolo/packages/cli/fakes 65
hours     ▁▁▁▁▁▁▁▃█▃▁▁▁▁▃▁▁▁▁▁▁▁▁▁  (0-23)
weekdays  Mon 0  Tue 16  Wed 0  Thu 0  Fri 0  Sat 0  Sun 0
```

Đây là đầu ra thật trên ledger ngày 2026-10-20; tuần trước không có đơn vị nào nên không có chênh lệch.
Thư mục in kèm tên repo (`<repo>/<thư mục>`), file ở gốc repo in tên repo; hiện tối đa 5 repo và 5 thư mục.

- Chênh lệch so với kỳ trước in sau XP, số đơn vị, từng tiêu chí rubric và tỉ lệ test, chỉ khi kỳ trước có dữ liệu cho chỉ số đó.
- Kỳ không có đơn vị nào thì in nhãn kỳ, streak và dòng `no contributions`.
- `--previous` in kỳ trước, so với kỳ trước nữa.
- Skill `/evolo` thêm `stats [week|month|quarter]`.

## 7. Test

- `stats.test.mjs`: ranh giới tuần, tháng, quý (đặt `TZ` cố định), kỳ trước qua đầu năm; mỗi chỉ số trên ledger giả; đơn vị triage bị loại khỏi trung bình rubric; `superseded` không vào độ ổn định; streak qua cuối tuần, hôm nay chưa có đóng góp, ngày thường bị bỏ; bản ghi không có `landedAt`.
- `views.test.mjs`: định dạng có và không có kỳ trước, kỳ rỗng, chữ có ký tự điều khiển.
- `ledger.test.mjs`: `summarize` theo `landedAt`, và thứ tự dự phòng của `landedAt(record)`.
- E2E (`worker.test.mjs`): bản ghi push có `landedAt` bằng `enqueuedAt` của job, bản ghi PR có `landedAt` bằng `mergedAt`; `evolo stats` chạy thật trên `EVOLO_HOME` của sandbox.
- Tạm gỡ phần code chính của từng chỉ số để chắc test bắt được lỗi.
