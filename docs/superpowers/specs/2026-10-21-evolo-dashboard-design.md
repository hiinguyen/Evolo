# Dashboard (`evolo dashboard`): thiết kế

Phần C trong bốn phần Game hoá (`docs/architecture.md` mục 9), sau A analytics (`evolo stats`, PR #9) và B achievement (`evolo achievements`, PR #10).
Dashboard không tính gì mới: nó gom các con số mà `stats.mjs`, `achievements.mjs`, `ledger.mjs`, `budget.mjs` và `review.mjs` đã tính, rồi vẽ chúng ở một chỗ.

## 1. Mục tiêu

- Xem mọi thứ Evolo biết ở một trang: level, XP, streak, từng đóng góp kèm rubric và công thức, analytics, achievement và review code.
- Review code là dữ liệu người dùng muốn xem đầu tiên, nên mỗi đóng góp có tab review riêng và có một trang liệt kê mọi review.
- Không server, không đăng nhập, không request mạng; dữ liệu không rời khỏi máy.
- Trang tự mới: bookmark một lần, mở lại là thấy dữ liệu mới nhất.

Không làm: thao tác từ trang (chấm lại, review, retry), vì trang tĩnh không gọi được CLI; so sánh với người khác; xuất ảnh hay PDF.

## 2. Quyết định đã chốt với người dùng

| Câu hỏi | Chốt |
|---|---|
| Cập nhật | Một file tĩnh `~/.evolo/dashboard.html`, tự sinh lại khi dữ liệu đổi; không server |
| Màn hình | Tổng quan, Dòng thời gian và chi tiết, Analytics, Achievement và Review, cả năm trong PR này |
| Phong cách | Kiểu công cụ sạch sẽ (thanh bên, thẻ, một màu nhấn, dark mode theo hệ thống) |
| Trang chi tiết | Dạng tab: Score, Review, Files, Commits |
| Achievement | Huy hiệu kiểu game (emblem màu ấm, vạch bậc, thanh tiến độ) trên nền chung của trang |
| Cách xây | Node tính model JSON, trình duyệt chỉ vẽ (phương án 1 trong ba phương án đã cân nhắc) |

Hai phương án bị loại:

- Node dựng sẵn toàn bộ HTML: file to gấp 2-3 lần, và bộ lọc hay đổi kỳ vẫn cần JS, nên có hai nơi lo hiển thị.
- Mỗi đơn vị một file HTML: mở rộng tốt nhất nhưng nhiều file và link tương đối, phức tạp hơn mức cần.

## 3. Kiến trúc

```
ledger/ reviews/ repos.json queue/ config.json
        │
        ▼
src/dashboard.mjs   dashboardModel(home, now)  ->  model JSON (mọi con số đã tính)
                    writeDashboard(home, now)  ->  ~/.evolo/dashboard.html (0600, ghi atomic)
        │
        ▼
dashboard/index.html   khung, CSP, chỗ nhúng CSS, JS và model
dashboard/style.css    token màu cho sáng và tối, khung trang, thành phần dùng chung
dashboard/<màn>.css    quy tắc riêng của từng màn hình
dashboard/*.mjs        hàm vẽ thuần model -> HTML theo màn hình, biểu đồ SVG; app.mjs: điều hướng, tab, bộ lọc
```

- Nguyên tắc "AI chỉ đánh giá, code mới tính toán" mở rộng thêm một bước: **Node tính, trình duyệt chỉ vẽ**.
  Mọi con số trên trang có trong model; phần vẽ không cộng, không lọc theo kỳ, không xếp hạng gì ngoài bộ lọc người dùng bấm.
- Phần vẽ là vài module ESM thuần, mỗi màn hình một file: `node:test` import được từng file; `app.mjs` chỉ tự khởi động khi có `document`.
- Trang mở bằng `file://`, nơi Chrome chặn module import lẫn nhau, nên `writeDashboard` nối các module theo thứ tự cố định thành một `<script type="module">`: bỏ dòng `import` từ module anh em và từ khoá `export`.
  Quy ước để việc nối này an toàn: module chỉ import từ module anh em, mỗi lệnh `import` một dòng, không trùng tên ở cấp cao nhất; test nạp bản đã nối như một module để bắt vi phạm.
  Không có bước build và không có dependency.
- `index.html`, các file CSS và các module nằm trong `packages/cli/dashboard/`, cạnh `judge/` và `claude/`; `writeDashboard` đọc chúng khi chạy.
  CSS cũng được nối theo thứ tự cố định (`STYLES`) thành một thẻ `<style>`: `style.css` trước, rồi file của từng màn hình, để quy tắc riêng của màn hình thắng quy tắc dùng chung nó thu hẹp.

## 4. Model

`dashboardModel(home, now)` trả về:

```js
{
  version: 1,
  generatedAt,                       // ISO
  level: { level, total, from, next },           // levelFor(summary.total), kèm tổng XP
  recent: { today, week },                       // recentXp(summary, now)
  streak: { current, longest },                  // streakOf
  budget: { spent, limit },                      // dailyBudget
  queue: { waiting, parked },                    // listJobs: job đang chờ, và job có budgetDay (chờ trần chi phí)
  periods: {                                     // cho week, month, quarter
    week: { current, previous },                 // computeStats(records, periodOf(kind, now, 0 | 1))
    ...                                          //   kèm days: [{ day, xp }] cho biểu đồ XP theo ngày
  },
  achievements: {
    visible: [...],                              // achievementsOf, achievement hiện: tên, mô tả, bậc, tiến độ, ngày mở
    secretsFound: [...],                         // achievement ẩn đã mở: tên, mô tả, ngày mở
    secretsHidden,                               // chỉ một con số
    recent: [...],                               // unlockedIn tuần này
  },
  units: [...],                                  // mọi bản ghi, mới nhất trước (theo landedAt), đã rút gọn
  reviews: [...],                                // listAllReviews, mới nhất trước
}
```

Một đơn vị trong `units` giữ đúng những gì trang hiện:

- `repo`, `id`, `kind`, `status`, `previousStatus`, `xp`, `summary`, `reason`, `at`, `landedAt`.
- Từ `result`: `method`, `xp` (XP lúc chấm; đơn vị bị revert hay superseded có `xp` về 0 nhưng `result.xp` giữ nguyên, để trang gạch ngang XP đã mất), `judge` (backend, model), `costUsd`, `failures`, `issues`, `evaluation` (loại, điểm rubric kèm `reason` và `evidence`, `flags`), `breakdown`.
- Từ `facts`: `diffMode`, `totals`, `files` (`path`, `class`, `additions`, `deletions`), `commits` (`sha`, `subject`, `date`, `revertedBy`), `excluded` (`sha`, `subject`, `reason`), `pr` (`number`, `title`, `url`, `mergedAt`).
- `signals`.

Bỏ: thân PR, thân commit, `sessionID`, `notes` của judge, `deniedCommands`, `job`; chúng dài và không hiện trên trang.

Achievement ẩn chưa mở chỉ có mặt dưới dạng con số `secretsHidden`, nên xem mã nguồn trang cũng không thấy tên hay điều kiện của chúng.

## 5. Khi nào trang được sinh lại

| Lúc | Điều kiện |
|---|---|
| `evolo dashboard` | Luôn sinh lại và luôn in đường dẫn; trừ khi có `--no-open`, còn chạy `xdg-open` tách rời (lệnh trả về ngay, không có `xdg-open` cũng không báo lỗi) |
| Worker xong một job hoặc một lần sync | Chỉ khi `dashboard.html` đã tồn tại; sinh lại cả khi sync không đổi gì, vì rẻ và làm mới ảnh chụp hàng đợi |
| `evolo review` lưu một review | Chỉ khi `dashboard.html` đã tồn tại |

- "Đã tồn tại" nghĩa là người dùng đã mở dashboard ít nhất một lần; Evolo không tự tạo một file vài MB mà người dùng chưa cần.
- Lỗi khi sinh trang (template mất, bản ghi hỏng) chỉ ghi `evolo.log`; chấm điểm và review không bao giờ dừng vì dashboard.
- Trang hiện giờ sinh, để biết nó mới tới đâu; hàng đợi và chi phí là ảnh chụp lúc đó.

## 6. Màn hình

Điều hướng bằng hash, nên nút Back của trình duyệt và bookmark một đơn vị đều dùng được:

| Hash | Màn hình |
|---|---|
| `#/` | Overview |
| `#/timeline` | Timeline (bộ lọc nằm trong hash, ví dụ `?repo=hiinguyen/Evolo&type=feature`) |
| `#/unit/<owner>/<name>/<id>/<tab>` | Chi tiết một đơn vị, tab `score` (mặc định), `review`, `files`, `commits` |
| `#/analytics/<week\|month\|quarter>/<current\|previous>` | Analytics |
| `#/achievements` | Achievements |
| `#/reviews` | Reviews (lọc theo mức độ) |

- **Overview:** level và thanh tiến độ tới level sau, tổng XP, XP hôm nay và 7 ngày, streak hiện tại và dài nhất, huy hiệu mở trong tuần, 5 đơn vị gần nhất, chi phí judge hôm nay trên trần, số job đang chờ, giờ sinh trang.
- **Timeline:** mọi đơn vị, kể cả `failed`, `reverted`, `superseded` (có nhãn trạng thái, XP gạch ngang khi mất); lọc theo repo, loại việc, trạng thái; bấm một dòng thì mở chi tiết.
- **Chi tiết:** đầu trang có repo, nhãn đơn vị (`PR #9`, `push 65d6615..a2205df`), XP, loại, ngày tới nơi, link PR, tóm tắt của judge.
  - Score: năm tiêu chí với thanh 0-4, lý do và bằng chứng; công thức `base × value × size × repo × signals = raw -> XP`; tín hiệu; cảnh báo của validator và flag; với đơn vị triage bằng luật hay chưa chấm được thì hiện lý do, giống `evolo why`.
  - Review · N (N là số vấn đề): nhận xét, điểm mạnh, điều cần cải thiện, vấn đề xếp theo mức độ kèm `file:dòng`; chưa có review thì hiện lệnh `evolo review <id>` để chép.
  - Files: file theo loại (source, test, docs, config...), số dòng thêm và xoá.
  - Commits: commit được tính kèm revert, commit bị bỏ kèm lý do.
- **Analytics:** chọn kỳ (tuần, tháng, quý) và kỳ này hoặc kỳ trước (khoảng hở đã biết: model chỉ giữ hai kỳ cho mỗi loại, nên màn "previous" không có số thay đổi so với kỳ trước nữa như `evolo stats --previous`); XP theo ngày (cột), cơ cấu loại việc, trung bình rubric so với kỳ trước, kỷ luật test, revert, repo, thư mục, nhịp theo giờ và theo thứ; số liệu giống hệt `evolo stats`.
- **Achievements:** đầu trang "13 / 33 · ★ 3 secrets · ? 25 hidden"; lưới huy hiệu với emblem, tên, vạch bậc, tiến độ tới bậc sau và ngày mở; achievement ẩn đã mở có ★; mỗi achievement ẩn còn lại là một ô "?".
- **Reviews:** mọi review, mới nhất trước, mỗi review một thẻ có số vấn đề theo mức độ; lọc theo mức độ; bấm thì mở tab Review của đơn vị.

Giao diện:

- Chữ tiếng Anh như CLI; chữ của judge và review giữ nguyên ngôn ngữ đã viết.
- Font hệ thống, không tải font ngoài; một màu nhấn xanh; huy hiệu dùng màu cam ấm.
- Màu là token CSS trên `:root`, đổi theo `prefers-color-scheme`.
- Dùng tốt từ 360 px: dưới khoảng 720 px thanh bên thành thanh trên cùng (cuộn ngang, mục đang mở được cuộn vào tầm nhìn).
  - Thẻ số liệu giữ hai cột trên điện thoại và giá trị không bao giờ tràn khỏi thẻ.
  - Lưới huy hiệu của Achievements xếp được 3 ô mỗi hàng ở 360 px.
  - Từ 560 tới 1079 px năm thẻ của Overview xếp 3 rồi 2, mỗi hàng đủ bề ngang; sáu số của Analytics xếp 3 và 3.
  - Dải huy hiệu mở trong tuần ở Overview hiện tối đa 10 huy hiệu, theo thứ tự của model, rồi một link "+N more" tới `#/achievements`; tiêu đề vẫn đếm tất cả.
- Mọi trạng thái trống có câu hướng dẫn (chưa có đơn vị, chưa có review, kỳ không có gì).

## 7. Bảo mật

- Trang chứa tóm tắt, lý do của judge, đường dẫn file và review code, nên file mới được tạo với quyền 0600; file đã có giữ quyền của nó, như `writeJson`.
- CSP trong `<meta>`: `default-src 'none'; script-src 'sha256-<hash>'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`.
  Không có `connect-src`, nên trang không gọi được mạng dù chữ nào lọt vào.
  Node dựng trang nên tính SHA-256 (base64) của đúng đoạn chữ nằm trong `<script type="module">` rồi ghi vào CSP.
  Nhờ vậy chỉ script đó chạy được, và một lỗi thoát chữ sau này không biến chữ từ dữ liệu thành script chạy.
  `style-src` vẫn là `'unsafe-inline'` vì các màn hình đặt `style="width:..."` trực tiếp.
  Khối model là `type="application/json"`, trình duyệt không chạy nó nên không cần hash.
- Mọi chữ đến từ dữ liệu đi qua một hàm `escape` duy nhất trong `dashboard/html.mjs`; link chỉ nhận URL bắt đầu bằng `https://`.
- Model được nhúng trong `<script type="application/json">` với mọi `<` thoát thành `\u003c`, nên `</script>` trong commit hay PR không thoát ra khỏi khối dữ liệu.

## 8. Module

| File | Vai trò |
|---|---|
| `src/dashboard.mjs` | `MODULES` và `STYLES` (thứ tự nối module và CSS), `dashboardModel` (mỗi đơn vị có `result.xp`, XP lúc chấm, để hiện số bị mất), `writeDashboard` (đọc template, nhúng CSS, JS và model, ghi atomic 0600), `refreshDashboard` (chỉ ghi khi file đã có, nuốt lỗi vào log) |
| `dashboard/index.html` | Khung trang, CSP, chỗ nhúng |
| `dashboard/style.css` | Token màu, khung trang, thành phần dùng chung (panel, hàng, pill, nút, segmented control, huy hiệu); chạy đầu tiên trong `STYLES` |
| `dashboard/overview.css`, `timeline.css`, `unit.css`, `analytics.css`, `achievements.css`, `reviews.css` | Quy tắc riêng của từng màn hình; `STYLES` nối theo thứ tự `style.css`, rồi các file này |
| `dashboard/fixtures.mjs` | Model mẫu dùng chung cho test của các màn hình |
| `dashboard/html.mjs` | `escape`, `safeUrl`, định dạng số và giờ dùng chung |
| `dashboard/charts.mjs` | Biểu đồ SVG: cột theo ngày, thanh ngang, dải theo giờ và thứ |
| `dashboard/overview.mjs`, `timeline.mjs`, `unit.mjs`, `analytics.mjs`, `achievements.mjs`, `reviews.mjs` | Mỗi file vẽ một màn hình từ model |
| `dashboard/app.mjs` | Router hash, khung trang (thanh bên), bộ lọc, khởi động trong trình duyệt |
| `bin/evolo.mjs` | Lệnh `dashboard [--no-open]`; `review` gọi `refreshDashboard` sau khi lưu |
| `src/worker.mjs` | Gọi `refreshDashboard` sau mỗi job và mỗi lần sync |
| `src/store.mjs` | Ghi file chữ atomic giữ quyền (dùng chung với `writeJson`) |

Skill `/evolo` không đổi: nó chỉ chạy `status`, `why`, `retry`.

## 9. Test

- `src/dashboard.test.mjs`:
  - model trên bản ghi giả: level, streak, số của từng kỳ khớp `computeStats`, đơn vị xếp theo `landedAt`;
  - trường bị bỏ không có trong model;
  - achievement ẩn chưa mở không có tên hay mô tả nào trong model;
  - bản ghi chưa chấm (`push_failed`, `failed`) và bản ghi cũ thiếu trường vẫn vào model;
  - trang ghi ra có quyền 0600, `</script>` trong dữ liệu không phá khối JSON;
  - bản nối các module nạp được như một module (không trùng tên, không còn `import` hay `export`).
- `dashboard/*.test.mjs` (một file test cho mỗi module):
  - mỗi màn hình vẽ đúng các con số của model;
  - chữ độc (`<img onerror>`, `javascript:` URL) bị escape hoặc bỏ;
  - trạng thái trống;
  - router đọc đúng hash.
- E2E (`src/dashboard.e2e.test.mjs`, sandbox thật):
  - `evolo dashboard --no-open` tạo trang chứa đơn vị vừa chấm;
  - worker chấm xong một push thì trang đã có được ghi lại, còn khi chưa có thì không tạo;
  - `evolo review` ghi lại trang và review hiện trong model.
- Kiểm tra test bắt được lỗi bằng cách tạm gỡ từng phần chính (điều kiện "đã tồn tại", escape, lọc achievement ẩn, gọi `refreshDashboard` trong worker).
- Kiểm chứng thật: sinh trang từ `~/.evolo` thật, mở bằng Chrome DevTools, chụp mọi màn hình ở chế độ sáng, tối và 360 px, soát lỗi giao diện và lỗi console.
