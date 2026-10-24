# Dữ liệu đèn tín hiệu (tuỳ chọn)

`signals.json` là danh sách nút giao chạy kế hoạch pha cố định, do đơn vị quản lý nút cung cấp. Không có dữ liệu công khai; để trống thì tính năng tắt.

```json
[
  {
    "id": "NG-001",
    "name": "Lê Lợi – Nguyễn Huệ",
    "lat": 10.7731, "lng": 106.7020,
    "cycleS": 90,
    "offsetS": 0,
    "approaches": [
      { "heading": 90,  "greenStart": 0,  "greenEnd": 40, "yellowS": 3 },
      { "heading": 180, "greenStart": 45, "greenEnd": 85, "yellowS": 3 }
    ]
  }
]
```

- `cycleS`: chu kỳ (giây). `offsetS`: giây kể từ 00:00 giờ Việt Nam mà chu kỳ bắt đầu.
- Mỗi hướng tiếp cận: hướng xe tới nút (độ, 0 = bắc), giây bắt đầu/kết thúc xanh trong chu kỳ, số giây vàng.
- Chỉ đúng khi tủ chạy đúng kế hoạch và đồng hồ điện thoại đúng giờ.
