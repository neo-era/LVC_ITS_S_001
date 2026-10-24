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

### Nhà cung cấp cắm được (provider abstraction)
Mỗi dịch vụ ngoài đi qua một giao diện chung, đổi nguồn không phải sửa app:
- **Nền bản đồ:** OpenStreetMap (ô vector miễn phí, không khoá — kiểm tra điều khoản ở Task 3). VietMap là tuỳ chọn nếu xin được khoá miễn phí.
- **Tìm địa điểm:** Nominatim/Photon (OSM) — chỉ gọi khi người dùng gõ, có debounce và cache.
- **Tính tuyến:** dịch vụ routing miễn phí trên nền OSM, có giới hạn lượt/ngày (chọn cụ thể ở Task 3).
- Trạng thái đã xác minh: VietMap **chưa xác nhận được gói miễn phí** (trang chính thức chỉ công bố tính phí theo giao dịch, báo giá khi liên hệ).

## 4. Dữ liệu cảnh báo (cập nhật thường xuyên)
- **GitHub Actions chạy hằng đêm:** gom camera, giới hạn tốc độ từ OSM (Overpass) + danh sách do anh nhập trên Google Sheet → xuất **JSON theo ô lưới** vào repo, kèm `version.json`.
- App kiểm tra `version.json` khi có mạng, tải ô lưới mới, lưu máy (IndexedDB) → dùng offline.
- Chỗ OSM thiếu `maxspeed` → ẩn biển; anh bổ sung dần qua Sheet.
- Ô lưới: cạnh ~1 km, chỉ tải các ô quanh vị trí + dọc tuyến.

## 5. Camera hành trình
- Quay theo đoạn 1–3 phút, độ phân giải chọn được; lưu vào thư mục riêng của app trên máy.
- Quay vòng: khi vượt dung lượng đặt (mặc định 32 GB) thì xoá đoạn thường cũ nhất; **clip khoá không bị xoá**.
- Khoá clip: cảm biến gia tốc vượt ngưỡng (giữ đoạn trước + sau sự cố) hoặc bấm tay.
- Chèn tốc độ, toạ độ, giờ lên video (hoặc tệp phụ đi kèm nếu chèn trực tiếp tốn pin).
- Xem lại trong app kèm bản đồ lộ trình; chép ra qua chia sẻ/USB. **Không tải video lên Drive.**
- PWA: quay được khi màn hình sáng; quay nền và ghi file lớn chỉ đảm bảo ở bản Android/iOS.

## 6. Google Drive / Sheet (qua Apps Script, giống sổ An toàn – Duy tu)
- Sheet: địa điểm đã lưu, danh sách clip khoá (giờ, toạ độ, tốc độ, ghi chú), cài đặt, danh sách camera/điểm đen do anh nhập.
- Apps Script chậm (vài giây) và có hạn mức → chỉ đồng bộ nền, mọi thứ chạy từ bộ nhớ đệm trên máy.

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

## 9. Kế hoạch task (có kiểm chứng)
1. Chốt UI (3 mẫu) → chọn. **[CHỐT DUYỆT]**
2. Viết test: lọc nhiễu tốc độ, tra giới hạn, tìm cảnh báo theo bán kính/hướng, chống báo lặp, quản lý quay vòng dung lượng. **[TDD]**
3. Chọn nguồn miễn phí cụ thể (ô bản đồ, tìm kiếm, routing) và kiểm tra điều khoản + hạn mức.
4. Quy trình dữ liệu: GitHub Actions hằng đêm → JSON ô lưới + `version.json`.
5. Code PWA: tốc độ + giới hạn + cảnh báo giọng nói + bản đồ/dẫn đường + lưu địa điểm.
6. Review độc lập (subagent): ca xấu GPS, dữ liệu hỏng, dung lượng.
7. Kiểm chứng: test + ca xấu + Lighthouse PWA + cài thử + chạy thử trên xe. **[CHỐT DUYỆT]**
8. Giai đoạn Android: camera hành trình, GPS nền, APK bằng Actions.
9. Giai đoạn iOS (sau khi anh quyết định tài khoản Apple).
10. Giai đoạn 2: người dùng tự báo sự cố (cần xác thực + chống báo sai).
