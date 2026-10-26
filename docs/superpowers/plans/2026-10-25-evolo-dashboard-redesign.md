# Kế hoạch: Redesign dashboard Evolo — theme tay, diện mạo dev, rank & achievement mở trần

Ngày: 2026-10-25 · Trạng thái: **đã triển khai**
Phạm vi: chỉ lớp trình bày của dashboard + 2 config keys + công thức level + trần achievement. Không đụng logic chấm XP, judge, ledger.

## 0. Mục tiêu

1. Thêm setting **theme Light / Dark / System** cho dashboard, nhớ lựa chọn.
2. Diện mạo **developer console**: dễ đọc, số-nổi, vibe GitHub dimmed — đẹp hơn mà không phá khung hiện có.
3. **Biệt danh / rank theo level** (Intern → … → Legend) với hiệu ứng CSS tăng dần theo cấp.
4. **Nới trần level** (lên cấp đầu game chậm lại) và **nâng trần achievement** dễ max, thêm secret về publish/deploy.

## Ràng buộc bất di bất dịch (từ `CLAUDE.md` và thiết kế dashboard)

- Không npm dependency, không build step, không web font tải mạng (dashboard phải chạy offline từ `file://`) — mọi polish đến từ tokens, typography, spacing, hiệu ứng CSS thuần.
- Dashboard là 1 file HTML tĩnh sinh lại bằng `evolo dashboard`: script inline bị CSP khóa bằng SHA-256 hash (tự tính lúc generate), `style-src 'unsafe-inline'`.
- Mọi thứ user-facing tính lại thuần từ ledger; thay đổi công thức chỉ là tính lại, không migrate dữ liệu.

## 1. Chuẩn hoá nhịp tham chiếu (nền cho mọi con số trong plan)

Hồ sơ "dev chuyên cần" với Evolo: ~250 scored units/năm (1 unit/ngày làm việc), trung bình ~75–100 XP/unit (tính từ `computeXp`: base 10–80 × mValue 0.25–3.0 × mSize 0.5–1.5 × mRepo 0.8–1.6 × mSignals 1.0–1.2) → **~19,000 XP/năm**.

Mỗi achievement đo một hành vi khác nhau nên pace-năm khác nhau; trần mới của mỗi achievement = lượng hành vi đó trong **1 năm chuyên cần**.

## 2. Phase 1 — Theme: Light / Dark / System

### Cơ chế

- **Config keys mới** trong `src/config.mjs` (`CONFIG_KEYS`, có validate hai chiều sẵn):
  - `dashboard.theme` — `system | light | dark`, mặc định `system`.
  - `dashboard.name` — tên hiển thị (biệt danh người dùng), chữ/space, ≤ 24 ký tự, dùng ở Phase 3.
- `dashboardModel()` đưa `theme` và `name` vào JSON model (model hiện tại không mang cả hai).
- **Boot script nhỏ trong `<head>`, trước `<style>`** — chạy sync trước first paint, **không FOUC**:
  - Pref = `localStorage["evolo.theme"]` → fallback `model.theme` → fallback `system`.
  - Set `<html data-theme="light|dark">` (luôn là giá trị resolved; `system` hỏi `matchMedia('(prefers-color-scheme: dark)')`).
  - Khi pref là `system`: lắng nghe `matchMedia` change → đổi attribute runtime.
- **Toggle chỉ làm 2 việc**: ghi `localStorage` + đổi attribute. (file:// localStorage chạy trên Chrome/Edge/Firefox/Safari; nếu bị chặn thì rơi về default từ config — vô hại.)
- **CSS refactor** `dashboard/style.css`: bỏ block `@media (prefers-color-scheme: dark)`, giữ đúng **1 block** `:root[data-theme="dark"] { … }` (kèm `color-scheme: dark`). Nguồn sự thật đơn nhất, không duplicate tokens.
- **CSP** mở rộng: `contentSecurityPolicy(scripts)` nhận mảng script → mỗi script một hash `'sha256-…'` nối bằng space. Hash tự tính lúc generate, không có bước manual.

### UI

- Nút **gear** ở đáy sidebar (mobile ≤719px: góc phải top bar) → popover nhỏ với **segmented control 3 nút** Light / Dark / System; segment mở sáng accent, `aria-pressed`, đóng bằng Esc/click ngoài.

### Sketch

```js
// contentSecurityPolicy(scripts) — src/dashboard.mjs
export function contentSecurityPolicy(scripts) {
  const hash = (s) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;
  return `default-src 'none'; script-src ${scripts.map(hash).join(" ")}; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`;
}
```

```js
// theme.mjs (mới, vào MODULES) — phần resolve, chạy cả lúc boot lẫn khi toggle
export function resolveTheme(pref, dark) {
  return pref === "light" || pref === "dark" ? pref : dark ? "dark" : "light";
}
```

### File thay đổi

| File | Thay đổi |
|---|---|
| `dashboard/index.html` | thêm `<script>/*evolo:boot*/</script>` trong `<head>`, trước `<style>` |
| `dashboard/theme.mjs` | **mới**: resolver, segmented control, matchMedia listener |
| `dashboard/app.mjs` | `renderShell` thêm gear + popover; `MODULES` thêm `theme.mjs` |
| `dashboard/style.css` | dark tokens đổi selector sang `[data-theme="dark"]` |
| `src/dashboard.mjs` | model thêm `theme`/`name`; CSP nhận 2 script; template thay `/*evolo:boot*/` |
| `src/config.mjs` | 2 key mới + validate |

### Nghiệm thu

- Toggle từng chế độ → reload giữ nguyên lựa chọn; để `System` rồi đổi theme OS → dashboard theo ngay.
- Không nhấp nháy sai theme lúc mở file (boot chạy trước style).
- `node --test`: validate 2 config keys, CSP có 2 hash, bundle load được.

## 3. Phase 2 — Diện mạo developer console

Hướng: giữ khung tối giản hiện tại, chuyển cảm giác sang **GitHub dimmed / Linear** — tinh, dễ đọc, số-nổi. Chỉ tokens + frame CSS, không đổi cấu trúc màn hình.

### Palette đề xuất

| Token | Light | Dark (mới, blue-tinted) |
|---|---|---|
| `--bg` | `#f6f7f9` | `#0d1117` |
| `--card` | `#ffffff` | `#161b22` |
| `--border` | `#e4e7ec` | `#30363d` |
| `--text` | `#1d1f24` | `#e6edf3` |
| `--muted` | `#6e7280` | `#8b949e` |
| `--accent` / `--accent-text` | `#0a84ff` / `#0066cc` | `#3b9dff` / `#3b9dff` |
| `--hover` / `--track` | `#f0f2f5` / `#e8ebf0` | `#21262d` / `#21262d` |

green/red/amber giữ nguyên (đã chuẩn GitHub). Việc đổi dark tokens kéo theo **harmony pass** riêng cho block dark của `dashboard/achievements.css` (surfaces `#151b27/#0d121c` tiệm về bảng mới).

### Các moves

1. **Typography**: số liệu (XP, level, counts, dates timeline) dùng `--mono` + `tabular-nums` một cách nhất quán; heading `600 / -0.01em`; nav 13px medium. Không thêm font (offline).
2. **Texture**: nền `--bg` phun dot-grid cực nhẹ bằng `radial-gradient` lặp (vibe blueprint), opacity ~3–4%.
3. **Cards**: border 1px + shadow mềm ở light; dark thêm hairline highlight 1px trên đỉnh card.
4. **Sidebar**: active item = pill `--accent-soft` + icon tint accent; transition 120ms cho hover/nav.
5. **Charts/heatmap**: giữ logic; thêm glow nhẹ cho line accent, bo góc cell heatmap.
6. **Motion + a11y**: transition gom 120–160ms; thêm `@media (prefers-reduced-motion: reduce)` tắt animation; giữ `:focus-visible`.

### Nghiệm thu

- Mở dashboard cả 2 theme, spot-check contrast text ≥ 4.5:1 (giữ pattern `--accent-text` đậm hơn cho chữ nhỏ).
- Không rơi token cứng (hex/rgba) ngoài `style.css`/`achievements.css` ở các màn hình.

## 4. Phase 3 — Rank theo level ("biệt danh")

### 4.1 Nới trần level: công thức mới `20 × L × (L + 9)`

Sửa 1 hàm trong `src/score.mjs`; bump `LEVEL_FORMULA_VERSION` `1.0` → `1.1`. XP trong ledger giữ nguyên — level tính lại thấp hơn, mọi UI "X XP to level N+1" ăn theo tự động.

```js
// Reaching level L takes 20 × L × (L + 9) XP in total: 20 × L² plus a linear term
// 180 × L that paces the early game — level 1 alone costs 200 XP instead of 20,
// while the ladder keeps one ceiling (level 50 = 59,000 XP).
const LEVEL_XP_FACTOR = 20;
const LEVEL_XP_DRIFT = 9;

export function levelFor(totalXp) {
  // L(L + 9) = (L + 4.5)² − 20.25, so the inverse stays one closed form.
  const level = Math.floor(
    Math.sqrt(Math.max(0, totalXp) / LEVEL_XP_FACTOR + (LEVEL_XP_DRIFT / 2) ** 2) - LEVEL_XP_DRIFT / 2
  );
  const from = LEVEL_XP_FACTOR * level * (level + LEVEL_XP_DRIFT);
  const next = LEVEL_XP_FACTOR * (level + 1) * (level + 1 + LEVEL_XP_DRIFT);
  return { level, from, next };
}
```

Tốc độ lên cấp: →L1 **200 XP** (cũ 20), →L2 +240 (cũ +60), →L3 +280, →L4 +320, →L5 +360; tổng tới L10 = 3,800 (cũ 2,000), L20 = 11,600 (cũ 8,000), **L50 = 59,000** (cũ 50,000, chỉ +18%).

### 4.2 Thang rank — 11 bậc, mỗi bậc 5 level, Legend mở tới vô cực

`src/rank.mjs` **(mới)** đặt cạnh `levelFor`; model xuất `rank` + `name`:

```js
const RANKS = [
  { min: 0,  name: "Intern" },
  { min: 5,  name: "Junior Dev" },
  { min: 10, name: "Mid-level Dev" },
  { min: 15, name: "Senior Dev" },
  { min: 20, name: "Staff Engineer" },
  { min: 25, name: "Principal Engineer" },
  { min: 30, name: "Architect" },
  { min: 35, name: "Distinguished Engineer" },
  { min: 40, name: "Master" },
  { min: 45, name: "Grandmaster" },
  { min: 50, name: "Legend" },
];
export function rankFor(level) { /* scan từ cuối về, clamp */ }
```

| # | Rank | Level | Tổng XP |
|---|---|---|---|
| 1 | Intern | 0–4 | 0 – 1,399 |
| 2 | Junior Dev | 5–9 | 1,400 – 3,799 |
| 3 | Mid-level Dev | 10–14 | 3,800 – 7,199 |
| 4 | Senior Dev | 15–19 | 7,200 – 11,599 |
| 5 | Staff Engineer | 20–24 | 11,600 – 16,999 |
| 6 | Principal Engineer | 25–29 | 17,000 – 23,399 |
| 7 | Architect | 30–34 | 23,400 – 30,799 |
| 8 | Distinguished Engineer | 35–39 | 30,800 – 39,199 |
| 9 | Master | 40–44 | 39,200 – 48,599 |
| 10 | Grandmaster | 45–49 | 48,600 – 58,999 |
| 11 | **Legend** | **50+** | **59,000+** |

Nửa đầu = thang sự nghiệp engineer thật (Intern → Distinguished); nửa sau = tier kiểu game (Master → Grandmaster → Legend), hiếm dần, hiệu ứng rực dần. Legend ở 59k XP — qua mốc `hoarder` platinum 50k (hoàn thành khi đang Grandmaster ~L46), thành endgame thật.

### 4.3 Effect ladder — 7 class CSS, cấp càng cao rực càng mạnh

| Class | Rank áp dụng | Hiệu ứng |
|---|---|---|
| `rank-muted` | Intern, Junior Dev | text muted, plain |
| `rank-tint` | Mid-level Dev | text màu accent |
| `rank-gradient` | Senior Dev | gradient text tĩnh (`background-clip: text`) |
| `rank-glow` | Staff, Principal | gradient + glow (`text-shadow`), Principal đậm hơn |
| `rank-shimmer` | Architect, Distinguished | animated shimmer (gradient chạy `background-position`) |
| `rank-blaze` | Master, Grandmaster | shimmer + glow + pulse chậm |
| `rank-legend` | Legend | gradient brand (amber→orange→hồng) + shine sweep + glow pulse |

Toàn bộ animation bọc trong `prefers-reduced-motion` guard.

### 4.4 Hiển thị

- **Sidebar foot** → identity block: `<name>` + chip rank (có effect) + **progress ring** SVG nhỏ tới level kế (thay dòng `Level 3 · 245 XP`).
- **Overview level card** → rank title hero có effect, dưới là "Level N — X XP to next level", giữ meter.
- **Terminal**: `evolo status` + statusline thêm tên rank (`Lv 3 · Mid-level Dev · 245 XP`).

### File thay đổi

`src/score.mjs` (levelFor + bump version) · `src/rank.mjs` (mới) · `src/dashboard.mjs` (model thêm `rank`/`name`/`theme`) · `dashboard/overview.mjs` (levelCard) · `dashboard/app.mjs` (sidebar foot) · `dashboard/style.css` + `overview.css` (effect ladder, ring) · `src/views.mjs` + `bin/evolo.mjs` (terminal).

### Nghiệm thu

- Test biên công thức: 199→L0, 200→L1, 1,399→L4, 1,400→L5, 58,999→L49, **59,000→L50**.
- Test biên rank: L0/2/4 Intern, L9 Junior, L20 Staff, L49 Grandmaster, L50 Legend, clamp L999.
- Fixture ledger XP cao xem được hiệu ứng Legend; test markup mới của identity block.

## 5. Phase 3b — Achievement: nâng trần + secrets mới

### 5.1 Luật

- **Chỉ thêm số vào cuối mảng `tiers`, không đổi số cũ** — tier đã mở giữ nguyên ngày (`reachedAt` binary search trên value đơn điệu, hoạt động đúng với ngưỡng mới, không đổi logic).
- Tối đa 6 tier/achievement (giới hạn hiển thị ROMAN là X = 10) — pips tự scale.
- Trần mới ≈ 1 năm pace thật của hành vi đó (mục 1); secrets là easter egg 1 tier, không áp luật này.
- `achievements.json` chỉ nhớ key đã announce → không cần migrate; tier mới đã vượt ngưỡng sẽ announce đúng một lần ở unit chấm kế tiếp.

### 5.2 Bảng tier đầy đủ (số in đậm = thêm mới)

**Volume — đếm tổng lượng**

| Achievement | Tiers | Trần mới ≈ |
|---|---|---|
| Contributor | 1, 10, 50, 100, 500 *(giữ)* | 500 units ≈ 1 năm đều 1.4/ngày làm việc |
| Merge Master | 1, 10, 50, 100, **200** | ~4 PR/tuần × 1 năm |
| Hoarder | 1,000, 5,000, 20,000, 50,000 *(giữ)* | 20k ≈ 1 năm; 50k = endgame ~3 năm |
| Jackpot (unit ≥200 XP) | 1, 5, 20, **50**, **100** | unit 200+ XP ~25% → 2/tuần × 1 năm |
| Overdrive (XP ngày đỉnh) | 300, 600, 1000, 2000 *(giữ)* | đo ngày đỉnh, không theo năm |
| Explorer (repos) | 2, 5, 10, **25** | ~2 repo mới/tháng |
| Polyglot (languages) | 2, 3, 5, **8**, **12**, **20** | 12 ngôn ngữ/năm polyglot thật; 20 = flex nhiều năm |
| By the Book | 10, 50, 200, **500**, **1000** | ~3 commit/unit → ~750–1,000/năm |
| Co-pilot | 1, 10, 50, **150**, **300** | trailer AI mặc định → ~1/ngày × 1 năm |

**Theo type — đếm unit đạt ngưỡng điểm**

| Achievement | Tiers | Trần mới ≈ |
|---|---|---|
| Builder (feature impact ≥3) | 3, 10, 30, **50** | ~1 feature mạnh/tuần |
| Bug Hunter | 3, 10, 30, **50** | ~1 bugfix mạnh/tuần |
| Architect (refactor centrality ≥3) | 3, 10, 30, **40** | ~0.8/tuần |
| Scribe (docs impact ≥2) | 3, 10, 30, **60** | ~1.2/tuần |
| Test Pilot (test quality ≥3) | 3, 10, 30, **60** | ~1.2/tuần |
| Plumber (infra impact ≥2) | 3, 10, 30, **40** | ~0.8/tuần |
| Janitor (xoá ≥20 dòng ròng) | 3, 10, 30, **75** | ~1.5/tuần |
| Guardian (security impact ≥3) | 1, 5, 15, **25** | ~2/tháng |
| Speed Demon (perf impact ≥3) | 1, 5, 15, **20** | ~1.5/tháng |
| Exterminator (đóng bug issue) | 1, 5, 20, **50**, **100** | ~2 issue/tuần |
| Craftsman (quality 4) | 5, 20, 50 *(giữ)* | ~1/tuần |
| Perfectionist (4 hết tiêu chí) | 1, 3, 10 *(giữ)* | ~1/tháng |
| Hard Mode (difficulty 4) | 1, 5, 20, **50** | ~1 unit khó/tuần |
| On Target (scope fit 4) | 5, 20, 50, **100** | ~2/tuần |
| Tiny but Mighty | 1, 5, 15, **30** | ~2.5/tháng |
| Test Believer (run chạm test) | 3, 10, 25, **100** | run 100 unit = kỷ luật TDD nhiều tháng liền |
| Green Light (CI first-pass PR) | 3, 10, 30, **100**, **200** | ~4 PR sạch/tuần |
| Core Contributor (1 repo) | 1, 5, 15 *(giữ)* | ≈ 1 năm cày một dự án |

**Nhịp thời gian — nhóm "cả năm" theo nghĩa đen**

| Achievement | Tiers | Trần mới ≈ |
|---|---|---|
| Streak (run ngày làm việc) | 5, 10, 30, 60, **120** | 120 ngày làm việc liên tiếp = nửa năm không lỡ ngày thường nào |
| Hat Trick (ngày ≥3 units) | 1, 5, 20, **50**, **100** | ~2 ngày crunch/tuần × 1 năm |
| Full Week (tuần đủ 5 ngày) | 1, 4, 12, **26**, **52** | **52 = cả năm tuyệt đối** — tier "100% completion" |
| Night Owl | 3, 10, 30, **100** | ~2 đêm/tuần × 1 năm |
| Early Bird | 3, 10, 30, **100** | ~2 sáng/tuần × 1 năm |
| Weekend Warrior | 3, 10, 30, **100** | ~2 unit cuối tuần/tuần × 1 năm |

Hai tier "kỷ luật sắt" — Full Week 52 và Streak 120 — là trophy near-impossible có chủ đích; muốn mềm thì 52→40, 120→100 (một số trong mảng).

### 5.3 Secrets mới: publish package / deploy GitHub

**Check kết quả:** 28 secret hiện tại không có cái nào về publish package, release hay deploy — gần nhất là `Inception` (scored một unit của chính repo Evolo). Thêm 3 secret đúng style hiện có (1 tier, ẩn, detect từ facts đã có: commits subject/body, files path), đủ bất biến "value không giảm khi thêm record" (dạng `any()`):

1. **Shipper** — commit subject mang version semver (`v1.2.3`, `chore(release): …`).
2. **To Production** — subject bắt đầu `deploy`, hoặc đụng file `.github/workflows/*deploy*`.
3. **One Point Oh** — subject chứa `1.0.0`.

Trung thực về giới hạn: công cụ chỉ đọc tín hiệu commit — không telemetry deploy thật; mô tả nói "deploy commit/workflow", không nói "đã deploy thành công".

> Spoiler note: theo thiết kế achievement, secret không được liệt kê trong tài liệu hướng người dùng (`handoff.md`, `architecture.md`) — phần này chỉ dành cho người triển khai.

### File thay đổi

`src/achievements/catalog.mjs` (mảng tiers) · `src/achievements/secret.mjs` (+3 rules) · test catalog.

### Nghiệm thu

- Biên từng trần mới (value == ngưỡng → mở; ngưỡng −1 → chưa).
- Mảng tiers tăng dần, số tier ≤ 10.
- 3 secret: monotone, tên/điều kiện không rò vào `handoff.md`/`architecture.md`.

## 6. Phase 4 — Polish cuối

- **Level-up**: shine sweep one-shot trên level card (so `model.level` với `localStorage["evolo.lastLevel"]`, chỉ chạy khi tăng).
- **Mobile ≤719px**: gear + identity chip gọn vào top bar.
- Rà 7 màn hình: spacing nhất quán 8px grid; empty states có icon + 1 câu.

## 7. Bản đồ file thay đổi (tổng)

| Nhóm | File |
|---|---|
| Config | `src/config.mjs` |
| Nguồn sự thật | `src/score.mjs`, `src/rank.mjs` (mới), `src/views.mjs`, `bin/evolo.mjs` |
| Sinh trang | `src/dashboard.mjs` |
| UI | `dashboard/index.html`, `theme.mjs` (mới), `app.mjs`, `overview.mjs` |
| CSS | `style.css`, `overview.css`, `achievements.css` (harmony pass), các màn hình còn lại (spacing) |
| Achievement | `src/achievements/catalog.mjs`, `src/achievements/secret.mjs` |

## 8. Rủi ro & cách giảm

| Rủi ro | Giảm thiểu |
|---|---|
| CSP 2 hash lệch tay | Hash tự tính lúc generate + test |
| localStorage bị chặn trên file:// nào đó | Rơi về default từ config, mất chỉ là quên lựa chọn |
| Đổi dark palette lệch màu achievements | Harmony pass riêng cho `achievements.css` |
| Shimmer rực quá khó đọc | Opacity/glow tiết chế + reduced-motion |
| Level hiện tại của người dùng tính lại thấp hơn | Nói rõ trong release note; XP không đổi, không migrate |

## 9. Không đụng vào

Logic XP/judge/rubric và `FORMULA_VERSION`, cấu trúc ledger & quyền 0600, cơ chế hàng đợi/worker, hợp đồng model trừ các key cộng thêm (`theme`, `name`, `rank`), catalog secret hiện có (chỉ thêm, không sửa).

## 10. Thứ tự làm

1. **Phase 1** (theme) — nền móng cho mọi bước sau.
2. **Phase 3** (rank + curve drift 9) — phụ thuộc identity block của Phase 1.
3. **Phase 3b** (achievement tiers + secrets) — độc lập, làm song song được.
4. **Phase 2** (diện mạo) — sau khi identity block ổn, để palette mới đỡ phải retint hai lần.
5. **Phase 4** (polish).
