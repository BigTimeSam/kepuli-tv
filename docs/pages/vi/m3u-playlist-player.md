---
title: Trình phát danh sách phát M3U trong trình duyệt | Kepuli-TV
description: Phát danh sách phát M3U hoặc M3U8 trong Chrome hay Firefox bằng Kepuli-TV. Dán địa chỉ hoặc chọn tệp để có nhóm kênh, logo, lịch phát sóng XMLTV và catch-up.
alt: Các kênh của một danh sách phát được nhóm theo quốc gia trong Kepuli-TV, một kênh đang phát
---

# Trình phát danh sách phát M3U trong trình duyệt

Kepuli-TV phát danh sách phát M3U trong một thẻ trình duyệt. Đưa cho nó địa
chỉ của danh sách phát hoặc chính tệp đó, và các kênh, phim và phim bộ trong
đó hiện thành những danh sách bạn có thể tìm kiếm, lọc và đánh dấu yêu thích.

## Thêm danh sách phát bằng địa chỉ

1. Cài Kepuli-TV rồi nhấp biểu tượng của nó trên thanh công cụ.
2. Dán địa chỉ của danh sách phát vào **Địa chỉ đăng ký hoặc danh sách
   phát**. Biểu mẫu bắt đầu ở **Địa chỉ danh sách phát (M3U)**.
3. Nhấn **Kết nối**. Trình duyệt hỏi có cho Kepuli-TV truy cập máy chủ đó
   không: chọn **Cho phép**, quyền này chỉ áp dụng cho máy chủ đó.

Danh sách phát không cần đăng nhập, chẳng hạn danh sách miễn phí, cũng dán
vào cùng ô đó.

## Hoặc chọn tệp

**Chọn tệp…** dưới ô địa chỉ nhận một danh sách phát bạn có sẵn trên thiết
bị: `.m3u`, `.m3u8` hoặc nén gzip. Tệp được đọc vào trình duyệt khi bạn nhấn
**Kết nối**, và không có gì được tải xuống cho việc này. Để cập nhật, hãy
chọn lại tệp trong **Cài đặt**: tài khoản, mục yêu thích và lịch sử của nó
vẫn giữ nguyên.

## Những gì được đọc từ danh sách phát

- **Nhóm, logo và mã lịch phát sóng** của danh sách `m3u_plus`, nhờ đó các
  kênh được sắp theo quốc gia và chủ đề.
- **Lịch phát sóng**: địa chỉ XMLTV mà danh sách phát nêu ở phần đầu, hoặc
  địa chỉ bạn nhập ở **Địa chỉ lịch phát sóng (XMLTV)**. Xem
  [lịch phát sóng](/iptv-epg-guide/).
- **Catch-up**, ở những kênh mà danh sách phát đánh dấu là có lưu trữ.
- **Phim và phim bộ** trong cùng danh sách, mỗi loại ở thẻ riêng.
- **Danh sách đơn giản không có nhóm** mà đánh dấu các phần bằng dòng tiêu
  đề (“===== Sweden =====”) sẽ được nhóm theo các tiêu đề đó.

## Khi không hoạt động

- **Địa chỉ không trả về danh sách phát M3U.** nghĩa là máy chủ đã trả lời
  bằng một trang web hoặc một lỗi: thường là trang đăng nhập hoặc thông báo
  tài khoản đã hết hạn. Hãy kiểm tra địa chỉ với nhà cung cấp.
- Nếu danh sách phát đến từ một máy chủ Xtream Codes, trình phát báo điều đó
  sau khi kết nối và đề xuất **Kết nối dạng Xtream Codes**, cách này đem lại
  danh mục, ảnh bìa và lịch phát sóng của máy chủ. Xem
  [Xtream Codes](/xtream-codes-player/).

Có thể giữ nhiều danh sách phát cạnh nhau dưới dạng tài khoản, mỗi cái có
mục yêu thích và lịch sử riêng. Xem thêm trong [hướng dẫn sử dụng](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (bằng tiếng Anh).
