---
title: Trình phát cổng Stalker trong trình duyệt, với địa chỉ MAC | Kepuli-TV
description: Xem cổng Stalker (MAG) trong Chrome hoặc Firefox mà không cần đầu thu. Kepuli-TV nhận địa chỉ của cổng và địa chỉ MAC đã đăng ký cho gói của bạn.
alt: Các kênh trực tiếp trong Kepuli-TV, một kênh đang phát bên cạnh danh sách
---

# Trình phát cổng Stalker trong trình duyệt

Nhà cung cấp bán dịch vụ cho đầu thu MAG sẽ đưa một địa chỉ cổng, thường kết
thúc bằng `/c/`, và đăng ký một địa chỉ MAC cho đầu thu. Không có tên người
dùng hay mật khẩu. Kepuli-TV nói chuyện với cổng như vậy từ một thẻ trình
duyệt, nên bạn xem được gói của mình mà không cần đầu thu.

## Kết nối với cổng

1. Cài Kepuli-TV rồi nhấp biểu tượng của nó trên thanh công cụ.
2. Dán địa chỉ của cổng vào **Địa chỉ đăng ký hoặc danh sách phát**. Địa chỉ
   kết thúc bằng `/c/` được nhận ra, và biểu mẫu chuyển sang **Cổng Stalker
   (địa chỉ MAC)**.
3. Nhập địa chỉ MAC đã đăng ký cho gói của bạn.
4. Nhấn **Kết nối** rồi chọn **Cho phép** khi trình duyệt hỏi có cho
   Kepuli-TV truy cập cổng không.

> [!IMPORTANT]
> Chỉ dùng địa chỉ MAC đã đăng ký cho gói của chính bạn. Không được dùng địa
> chỉ của người khác hoặc địa chỉ lấy từ danh sách chia sẻ: xem
> [điều khoản sử dụng](/terms/).

## Những gì hoạt động

- **Kênh, phim và phim bộ** đúng như cổng liệt kê.
- **Dữ liệu chương trình của chính cổng** trong danh sách và trong
  [lịch phát sóng](/iptv-epg-guide/).
- **Kết nối lại**: liên kết luồng của cổng thường chỉ dùng được cho một lần
  kết nối, nên trình phát xin liên kết mới mỗi khi mở lại một luồng trực
  tiếp.

## Những gì chưa hoạt động

- **Phần lưu trữ của cổng** (catch-up) chưa có.
- **Đồng bộ** bỏ qua tài khoản Stalker trừ khi bật **Gồm cả mật khẩu**, vì
  địa chỉ MAC có giá trị chẳng khác gì mật khẩu.

## Cách tiện ích truy cập cổng

Cổng chờ đợi một đầu thu MAG: địa chỉ MAC trong cookie và tên của đầu thu
thay cho tên trình duyệt. Trang web không tự đặt được những thứ đó, nên tiện
ích chỉ đặt chúng cho các yêu cầu của chính nó đến máy chủ của cổng, và quy
tắc này mất đi khi đóng trình duyệt. Chi tiết có trong
[hướng dẫn sử dụng](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals) (bằng tiếng Anh).
