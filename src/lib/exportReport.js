/**
 * Xuất báo cáo kế hoạch tháng ra PDF.
 * Cách 1: chụp phần tử báo cáo bằng html2canvas + jsPDF (tải từ cdnjs) -> file .pdf khổ A4.
 * Cách 2 (dự phòng): file .html đã định dạng sẵn — mở ra là tự bật hộp thoại In -> "Lưu thành PDF".
 */
import { saveFile } from './runtime.js';

const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((s) => s.src === src)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Không tải được ${src}`));
    document.head.appendChild(s);
  });
}

async function toPdf(el) {
  for (const src of LIBS) await loadScript(src);
  if (!window.html2canvas || !window.jspdf?.jsPDF) throw new Error('Thư viện PDF không khả dụng');
  const canvas = await window.html2canvas(el, { scale: 2, backgroundColor: '#ffffff', logging: false });
  const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const margin = 10;
  const imgW = 210 - margin * 2;
  const pxPerMm = canvas.width / imgW;
  const pageHpx = Math.floor((297 - margin * 2) * pxPerMm);
  for (let y = 0, page = 0; y < canvas.height; y += pageHpx, page += 1) {
    const h = Math.min(pageHpx, canvas.height - y);
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = h;
    slice.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    if (page) pdf.addPage();
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, imgW, h / pxPerMm);
  }
  return pdf.output('arraybuffer');
}

function toHtml(el, title) {
  const css = document.getElementById('app-css')?.textContent || '';
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap&subset=vietnamese" rel="stylesheet">
<style>${css}</style><style>@page{size:A4;margin:12mm}body{background:#fff;margin:0 auto;padding:16px;max-width:1000px}</style></head>
<body>${el.innerHTML}<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},500)})<\/script></body></html>`;
}

/** @returns {'pdf'|'html'} định dạng đã lưu */
export async function exportReport(el, baseName) {
  try {
    const buf = await toPdf(el);
    await saveFile(`${baseName}.pdf`, buf);
    return 'pdf';
  } catch (ex) {
    if (ex?.code === 'declined' || ex?.code === 'rate_limited') throw ex;
    await saveFile(`${baseName}.html`, toHtml(el, baseName));
    return 'html';
  }
}

/**
 * Xuất các trang in (phần tử .page trong tài liệu in) thành một file PDF khổ A4 — mỗi trang chụp riêng,
 * trang dài hơn A4 được cắt thành nhiều trang.
 */
export async function exportPagesPdf(printDoc, baseName) {
  for (const src of LIBS) await loadScript(src);
  if (!window.html2canvas || !window.jspdf?.jsPDF) throw new Error('Không tải được thư viện tạo PDF. Dùng nút "In / Lưu PDF" thay thế.');
  const body = printDoc.body;
  const prevZoom = body.style.zoom;
  body.style.zoom = '';
  try {
    // Chờ phông chữ nhúng (Waasee Serif — đủ dấu tiếng Việt) tải xong rồi mới chụp, tránh lỗi phông / dấu lệch
    if (printDoc.fonts) {
      await Promise.all(
        ['400 12pt "Waasee Serif"', '700 12pt "Waasee Serif"', 'italic 400 12pt "Waasee Serif"', 'italic 700 12pt "Waasee Serif"'].map((ff) => printDoc.fonts.load(ff, 'Tiếng Việt đầy đủ dấu').catch(() => null)),
      );
      await printDoc.fonts.ready;
    }
    const pages = [...printDoc.querySelectorAll('.page')];
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    pdf.setProperties({ title: baseName, creator: 'Quản lý Dòng tiền' });
    let first = true;
    for (const el of pages) {
      const canvas = await window.html2canvas(el, { scale: 2.5, backgroundColor: '#ffffff', logging: false, useCORS: true, windowWidth: el.scrollWidth });
      const pxPerMm = canvas.width / 210;
      const pageHpx = Math.floor(297 * pxPerMm);
      for (let y = 0; y < canvas.height - 2; y += pageHpx) {
        const h = Math.min(pageHpx, canvas.height - y);
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = h;
        slice.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
        if (!first) pdf.addPage();
        first = false;
        pdf.addImage(slice.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, 210, h / pxPerMm, undefined, 'FAST');
      }
    }
    await saveFile(`${baseName}.pdf`, pdf.output('arraybuffer'));
  } finally {
    body.style.zoom = prevZoom;
  }
}
