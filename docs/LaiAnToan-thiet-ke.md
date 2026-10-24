# Lái An Toàn — App cảnh báo giao thông + camera hành trình

> Doc thiết kế (Bước 1). Nguồn sự thật — cập nhật khi thiết kế thay đổi.
> Chốt Bước 0 ngày 2026-10-24. Tác giả: Mai Vũ Lâm. Tên tạm: "Lái An Toàn" (đổi được).
> Tham khảo chức năng: màn hình xe WYN (tốc độ + biển giới hạn), VietMap (dữ liệu đường VN), Map Me (lưu địa điểm, nhóm).

## 1. Mục tiêu
App chạy trên **điện thoại gắn kính xe** (iPhone và Android): hiện tốc độ GPS cỡ lớn, biển giới hạn tốc độ của đoạn đường, cảnh báo phía trước (camera phạt nguội, điểm đen), bản đồ + dẫn đường, và **camera hành trình** quay vòng, lưu video **trên máy**.
Ràng buộc: **0 đồng** vận hành (GitHub + Google Drive + dữ liệu mở), dữ liệu cảnh báo **cập nhật thường xuyên**.

## 2. Tiêu chí đạt (Bước 0 đã chốt)
1. Tốc độ GPS cỡ lớn, cập nhật ≥ 1 lần/giây, đọc rõ dưới nắng.
2. Biển giới hạn tốc độ của đoạn đường; không có dữ liệu → ẩn, không hiện số sai.
3. Vượt tốc độ → đổi màu + đọc cảnh báo bằng giọng tiếng Việt.
4. Cảnh báo phía trước (camera phạt nguội, điểm đen) theo bán kính cấu hình được, chạy **offline**.
5. Bản đồ nền + tìm địa điểm + vẽ tuyến + chỉ đường từng chặng bằng giọng tiếng Việt; tự tính lại ≤ 5 giây khi chạy lệch.
6. Camera hành trình: quay vòng theo đoạn, khoá clip khi va chạm hoặc bấm tay, lưu **trên máy**, tự xoá đoạn cũ khi đầy dung lượng đã đặt.
7. Lưu địa điểm, danh sách clip khoá, cài đặt lên Google Drive/Sheet.
8. Cài được trên iPhone và Android; sáng/tối; nút lớn; chữ tiếng Việt đủ dấu; WCAG AA.

**Ca xấu phải chịu được:** mất GPS (hầm, nhà cao tầng), tốc độ nhảy bất thường, từ chối quyền vị trí/camera, hết dung lượng, mất mạng khi cập nhật dữ liệu, dịch vụ tính tuyến hết hạn mức, tệp dữ liệu hỏng, đường một chiều/đường cấm.

## 3. Kiến trúc: một mã nguồn, ba cách chạy
| Cách chạy | Dùng cho | Hạn chế |
|---|---|---|
| **PWA** (GitHub Pages, HTTPS) | iPhone + Android, cài từ link | Phải để màn hình sáng (Wake Lock); không quay nền ổn định |
| **App Android** (Capacitor, APK) | GPS chạy nền, quay phim, ghi file | Cài trực tiếp APK, không phí |
| **App iOS** (Capacitor) | Như Android | Cần tài khoản Apple Developer ~99 USD/năm để cài ổn định (TestFlight); tài khoản miễn phí phải cài lại mỗi 7 ngày. Build bằng macOS runner của GitHub Actions |

**Thứ tự:** PWA + dữ liệu cảnh báo → Android → iOS.
Lõi: TypeScript + Vite + MapLibre GL. Vỏ native bằng Capacitor chỉ bổ sung quay nền và ghi file.

### Nguồn dịch vụ đã chọn (cập nhật 2026-10-24)
- **Nền bản đồ trực tuyến:** OpenFreeMap (ô vector OpenMapTiles từ dữ liệu OSM, miễn phí, không khoá, cho dùng thương mại, bắt buộc ghi nguồn). Không dùng tile.openstreetmap.org (cấm dùng offline/tải hàng loạt).
- **Bản đồ offline:** tự dựng — xem mục 4b.
- **Tìm địa điểm / tra ngược:** Photon (photon.komoot.io, "mức hợp lý", không cam kết) — chỉ gọi khi gõ ≥3 ký tự, chờ 450 ms.
- **Tìm đường:** Valhalla FOSSGIS (valhalla1.openstreetmap.de), chỉ dẫn `vi-VN`, gọi GET để tránh CORS; kiểu tìm đường theo loại xe (auto/motorcycle/truck/bus). Chưa đọc được điều khoản FOSSGIS → mức thử nghiệm cá nhân; dùng rộng cần máy chủ riêng hoặc VietMap.
- VietMap: chưa xác nhận gói miễn phí → để ngỏ.

## 4. Dữ liệu cảnh báo (toàn quốc, hằng đêm)
- **Quy trình `data.yml` (02:30 hằng đêm, ~3 phút):** tải bản trích OSM Việt Nam của Geofabrik → `osmium tags-filter` (đường cho xe + camera) → `osmium export` GeoJSONSeq → `tools/build-data.ts` → `public/data/cells/<ô>.json` (định dạng v2) + `version.json` (có thống kê độ phủ). Lưu vào cache Actions; `pages.yml` chỉ khôi phục bản đã lưu nên đăng trang vài phút.
- **Định dạng ô v2:** ô 0,01° (~1,2 km²); mỗi mục `[wayId, start, maxspeed|0, cờ, lat0, lng0, dlat, dlng…]` toạ độ ×1e5 hiệu số, hình học rút gọn 2 m. Cờ: bit0 tuyến có camera, bit1 đường đôi, bit2 không ước tính (cao tốc), bit3 đường nhỏ; `u:1` = khu đông dân cư (≥10 km đường/ô). Toàn quốc ~174 nghìn ô, ~158 MB.
- **Độ phủ `maxspeed` OSM (lần chạy đầu):** tổng 3,6% chiều dài; cao tốc 96,6%, trunk 23%, primary 19%, residential 0,5%.
- **Giới hạn ước tính theo luật** khi thiếu số (VBHN 74/2026/VBHN-BXD của TT 38/2024 + 09/2025): trong khu đông dân cư 60/50 mọi xe; ngoài khu đông dân cư ô tô con 90/80, mô tô 70/60, xe khách >28 chỗ/tải >3,5 t 80/70, buýt/đầu kéo 70/60. Biển nét đứt "Ước tính theo luật", **không đọc cảnh báo vượt tốc** với số ước tính.
- **Camera:** OSM chỉ có ~45 camera cả nước. Thêm (a) nhắc "Tuyến này có camera phạt nguội" theo danh sách tên đường báo chí (~43 tuyến TP.HCM, cập nhật 01/2026, không có toạ độ); (b) nút **Đánh dấu camera** → lưu trên máy → Supabase (dự án `lai-an-toan`, bảng `lat_camera_marks`, RLS: khoá công khai chỉ gửi dấu mới và đọc dấu `duyet`) → dấu đã duyệt vào dữ liệu đêm. Không lấy dữ liệu WYN/Google Maps (bản quyền, điều khoản).

## 4b. Bản đồ offline theo tỉnh
- **Quy trình `map.yml` (ngày 1 hằng tháng, ~5 phút):** Planetiler v0.10.2 (`--area=vietnam`) → `vn.pmtiles` (~305 MB) → ranh giới tỉnh (osmium, admin_level=4, ISO VN-) → `pmtiles extract --region` từng tỉnh (34 tỉnh/thành, ~345 MB, TP.HCM ~24 MB) → `provinces.json` (kèm đa giác rút gọn 300 m để gợi ý tỉnh đang ở) + style sáng/tối (OpenFreeMap positron/dark) đổi nguồn sang `latmap://`, sprite và font đặt cùng trang. Khánh Hòa dùng khung đất liền (ranh giới có Trường Sa ngoài bản trích).
- **App:** tải tỉnh vào Cache Storage (`lat-map-offline-v1`) kèm style/sprite/font; giao thức `latmap://z/x/y`: có mạng → ô OpenFreeMap (đủ vùng biên giới), lỗi/mất mạng → ô pmtiles trên máy; ô thiếu báo lỗi để tải lại khi có mạng. Nút Cập nhật khi có bản tháng mới.
- Tổng dữ liệu + bản đồ ~500 MB < giới hạn 1 GB của GitHub Pages.

## 5. Camera hành trình
- Quay theo đoạn 1–3 phút, độ phân giải chọn được; lưu vào thư mục riêng của app trên máy.
- Quay vòng: khi vượt dung lượng đặt (mặc định 32 GB) thì xoá đoạn thường cũ nhất; **clip khoá không bị xoá**.
- Khoá clip: cảm biến gia tốc vượt ngưỡng (giữ đoạn trước + sau sự cố) hoặc bấm tay.
- Chèn tốc độ, toạ độ, giờ lên video (hoặc tệp phụ đi kèm nếu chèn trực tiếp tốn pin).
- Xem lại trong app kèm bản đồ lộ trình; chép ra qua chia sẻ/USB. **Không tải video lên Drive.**
- PWA: quay được khi màn hình sáng; quay nền và ghi file lớn chỉ đảm bảo ở bản Android/iOS.

## 6. Lưu trữ dùng chung
- Không dùng Google Apps Script (anh chốt). Dấu camera đồng bộ qua **Supabase** (mục 4). Cài đặt, dấu, bản đồ đã tải lưu trên máy.
- Địa điểm đã lưu / danh sách clip khoá: làm sau, cùng Supabase.

## 7. Module
- `core/gps` — lọc nhiễu tốc độ, phát hiện mất GPS
- `core/speedlimit` — tra giới hạn tốc độ theo vị trí (khớp đoạn đường)
- `core/alerts` — tìm cảnh báo trong bán kính/hướng đi, chống báo lặp
- `core/voice` — đọc cảnh báo tiếng Việt (Web Speech / TTS native)
- `map/` — nền bản đồ, tìm kiếm, tuyến, chỉ đường (qua provider)
- `dashcam/` — quay vòng, khoá clip, quản lý dung lượng
- `data/` — tải/ cập nhật ô lưới, IndexedDB, đồng bộ Sheet
- `ui/` — design tokens, màn hình lái xe, bản đồ, camera, cài đặt

## 8. Rủi ro
- Dữ liệu OSM thiếu `maxspeed`/camera ở nhiều đoạn → độ phủ thấp lúc đầu (giảm bằng danh sách nhập tay).
- Routing miễn phí có trần lượt/ngày; dùng chung nhiều người sẽ chạm trần.
- iOS cần tài khoản Apple trả phí để chạy ổn định; PWA trên iOS bị hạn chế nền.
- Quay phim + GPS + màn hình sáng tốn pin, nóng máy → cần chế độ tiết kiệm, khuyến cáo sạc.
- An toàn: không thao tác khi xe chạy; chỉ bấm nút lớn và dùng giọng nói.
- Pháp lý: dữ liệu camera/điểm đen chỉ mang tính tham khảo; hiển thị rõ khi dùng dữ liệu cũ (ngày cập nhật).

## 9. Trạng thái (2026-10-24)
- Xong (PWA, repo `neo-era/LVC_ITS_S_001`, GitHub Pages bằng Actions): màn hình lái xe mẫu A (sáng/tối), mô phỏng, giọng đọc tiếng Việt (chọn giọng + kiểu Dễ thương/Bình thường/Trầm ấm), bản đồ + toàn màn hình có thẻ tốc độ/cảnh báo, dẫn đường (tìm theo tên hoặc chọn trên bản đồ, nhắc 300/100 m, tìm lại khi lệch), loại xe, dữ liệu toàn quốc, giới hạn ước tính, nhắc tuyến camera, đánh dấu camera, bản đồ offline theo tỉnh. 222 test.
- Chờ anh: dán `supabase/lat_camera_marks.sql` vào SQL Editor dự án `lai-an-toan`; chạy thử trên xe (GPS, giọng, offline trên iPhone).
- Tiếp theo: camera hành trình (Android/Capacitor), lưu địa điểm, iOS (khi quyết định tài khoản Apple), báo sự cố giai đoạn 2.
- Bài học: service worker phải `res.clone()` ngay (không trong promise); `pkill -f` trong cùng lệnh shell giết luôn shell; Playwright `setOffline` không mô phỏng đúng service worker → thử offline bằng cách tắt máy chủ.
