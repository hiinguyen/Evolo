# Evolo: quy tắc cho agent

Evolo là công cụ cá nhân chấm điểm đóng góp code trên GitHub bằng một AI judge và công thức XP tất định.
Trạng thái, quyết định và việc tiếp theo nằm ở `docs/handoff.md`: đọc file đó trước khi làm bất cứ việc gì.

## Bắt đầu một phiên

1. Đọc `docs/handoff.md`, rồi `docs/architecture.md` nếu cần bối cảnh thiết kế.
2. Chạy `git status` và `git switch main && git pull --ff-only` nếu không có việc dở.
3. Chạy test một lần để biết điểm xuất phát: `cd packages/cli && npm test`.

## Git và GitHub

`main` được bảo vệ bằng ruleset `main` (id 25459177, không ai được bỏ qua):
- không push thẳng lên `main`, mọi thay đổi đi qua PR;
- PR chỉ merge được khi ba check `test (20)`, `test (22)` và `test (24)` đều xanh;
- PR không cần approve, vì repo chỉ có một người;
- không xoá được `main`, không force push lên `main`.

Quy trình cho mỗi việc:

```bash
git switch main && git pull --ff-only
git switch -c <loại>/<tên-ngắn>          # feat/, fix/, docs/, ci/, refactor/, test/, chore/
# sửa, chạy npm test, commit
git push -u origin <nhánh>
gh pr create --base main ...             # mô tả có Summary và Test plan
gh pr checks --watch                     # chờ CI xanh
gh pr merge <số> --merge --delete-branch # merge commit, như các PR trước
```

- Chỉ commit, push, mở PR hoặc merge khi người dùng yêu cầu.
- Commit theo dạng `<type>: <mô tả>`, type là một trong `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.
  Thân commit giải thích vì sao, không chỉ liệt kê đã sửa gì.
- Không tắt ruleset, không thêm ai vào bypass list, không merge bằng quyền admin để né CI.
  CI đỏ thì sửa code cho xanh.
- Đổi tên job hoặc danh sách Node trong `.github/workflows/test.yml` thì phải sửa danh sách check bắt buộc trong ruleset theo, nếu không mọi PR sẽ chờ mãi một check không chạy.
- Push lên nhánh riêng không được Evolo chấm; PR được chấm khi merge, nên mỗi PR nên là một thay đổi trọn vẹn.

## Code

- Code nằm trong `packages/cli/`: JavaScript ESM (`.mjs`), không có bước build, không có dependency npm.
  Chỉ dùng thư viện chuẩn của Node.js cùng các lệnh `git`, `gh` và `claude`.
  Muốn thêm dependency thì hỏi người dùng trước.
- Phải chạy được trên Node 20 (`engines` trong `package.json`), dù máy này có Node mới hơn.
  CI chạy test trên Node 20, 22 và 24 để bắt API quá mới.
- Viết giống code xung quanh: tên rõ nghĩa, hàm nhỏ, dữ liệu không sửa tại chỗ (trả về bản mới), comment giải thích vì sao.
- Mọi lời gọi `gh` nằm trong `src/github.mjs`; rubric và prompt của judge chỉ nằm trong `judge/xp-judge.md`.
- AI chỉ chấm điểm rubric; XP do `computeXp` trong `src/score.mjs` tính.
  Không để kết quả của judge đi thẳng vào XP mà không qua validator.

## Test

- Test dùng `node:test` và `node:assert/strict`, đặt cạnh file nguồn: `src/<tên>.test.mjs`.
- Test E2E dùng `src/sandbox.mjs`: repo thật, remote bare, hook và worker thật; chỉ `gh`, `claude`, `notify-send` và `gdbus` là bản giả trong `fakes/`.
  Thêm lời gọi `gh` mới thì cập nhật `fakes/gh.mjs` cho khớp dữ liệu GitHub thật.
- Test không được phụ thuộc vào máy: không cần git identity toàn cục, không gọi mạng, không dùng `~/.evolo` thật.
- Sửa lỗi: viết test E2E tái hiện lỗi trước (phải đỏ), rồi mới sửa.
- Tính năng mới: có test, và kiểm tra test bắt được lỗi bằng cách tạm gỡ phần code chính.
- Thấy test lỗi hoặc chập chờn, kể cả không do mình gây ra, thì sửa luôn.
- Thay đổi dùng dữ liệu từ GitHub thì chạy thử với `gh` thật trên một repo công khai để chắc dữ liệu đúng dạng code chờ.

## Tài liệu

- Tài liệu viết bằng tiếng Việt, trong `docs/`.
- Mỗi câu một dòng trong file Markdown dài.
- Không dùng dấu gạch dài (em dash), dùng `-`.
- Xong một phần việc thì cập nhật `docs/handoff.md`: bảng "Đã làm" (kèm số PR), "Chưa làm", bảng file code, số test, mục kết quả của phần đó, "Việc tiếp theo".
  Cập nhật cả tài liệu thiết kế liên quan (`architecture.md`, `auto-scoring.md`, `xp-evaluation.md`, `review.md`) để cột trạng thái khớp với code.
- Không sửa tay CHANGELOG hay file được sinh tự động.

## Làm việc với người dùng

- Trả lời bằng tiếng Việt, ngắn gọn, nói rõ đã kiểm chứng gì và còn rủi ro gì.
- Ưu tiên chất lượng, đơn giản và bền vững hơn chi phí phát triển.
- Evolo chỉ dùng cho một người: không thêm chống gian lận, server hay leaderboard nếu người dùng không yêu cầu.

## Môi trường máy này

- Hook GateGuard đòi nêu sự thật trước lệnh Bash đầu tiên của phiên và trước khi tạo file mới: nêu rồi chạy lại đúng lệnh đó.
- Hook caveman có thể rút gọn đầu ra dài (`… elided (caveman) …`); cần xem nguyên văn thì đọc từng đoạn nhỏ, ví dụ `sed -n 'a,bp'`.
- Đừng dùng `pkill -f` hay `pgrep -f`; kill theo PID.
- Các bài học kỹ thuật khác (judge, `claude -p --restricted`, opencode, zsh): `docs/handoff.md` mục 6.
