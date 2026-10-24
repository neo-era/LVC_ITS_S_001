/**
 * Lái An Toàn — nhận dấu camera từ app và trả lại các dấu đã duyệt.
 *
 * Cài đặt:
 *  1. Tạo một Google Sheet mới, đặt tên "LaiAnToan-camera". Mở Tiện ích mở rộng → Apps Script, dán toàn bộ mã này.
 *  2. Triển khai → Triển khai mới → Loại: Ứng dụng web.
 *     Thực thi bằng: Tôi.  Ai có quyền truy cập: Bất kỳ ai.  → Sao chép địa chỉ .../exec.
 *  3. Dán địa chỉ đó vào app: Cài đặt → Camera tự đánh dấu → Địa chỉ đồng bộ.
 *  4. Mở Sheet, xem các dòng mới (cột "trạng_thái" = "mới"). Dòng đúng thì đổi thành "duyệt".
 *     Chỉ dòng "duyệt" mới được đưa vào dữ liệu cảnh báo ban đêm.
 */
var HEADERS = ['id', 'loại', 'vĩ_độ', 'kinh_độ', 'hướng', 'thời_điểm', 'thiết_bị', 'trạng_thái'];

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('camera') || ss.insertSheet('camera');
  if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
  return sh;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var marks = body.marks || [];
    if (marks.length > 200) return json_({ ok: false, error: 'Quá nhiều dấu một lần' });
    var sh = sheet_();
    var last = sh.getLastRow();
    var have = {};
    if (last > 1) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { have[r[0]] = true; });
    var saved = [];
    marks.forEach(function (m) {
      var okType = m.type === 'camera' || m.type === 'blackspot';
      var ok = typeof m.id === 'string' && m.id && okType && isFinite(m.lat) && isFinite(m.lng) &&
        m.lat >= 8 && m.lat <= 24 && m.lng >= 102 && m.lng <= 110;
      if (!ok) return;
      if (!have[m.id]) {
        sh.appendRow([m.id, m.type, m.lat, m.lng, m.dir === undefined ? '' : m.dir, new Date(m.t), String(body.device || '').slice(0, 40), 'mới']);
        have[m.id] = true;
      }
      saved.push(m.id);
    });
    return json_({ ok: true, saved: saved });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** GET ?action=approved → các dấu đã duyệt, dùng cho bước lấy dữ liệu ban đêm. */
function doGet(e) {
  var sh = sheet_();
  var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues() : [];
  var marks = rows
    .filter(function (r) { return r[7] === 'duyệt'; })
    .map(function (r) { return { id: r[0], type: r[1], lat: r[2], lng: r[3], dir: r[4] === '' ? undefined : r[4], t: 0 }; });
  return json_({ marks: marks });
}
