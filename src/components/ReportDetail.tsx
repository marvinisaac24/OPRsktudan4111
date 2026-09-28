import React, { useState, useEffect, useRef } from 'react';
import { doc, getDoc, getDocFromCache } from 'firebase/firestore';
import { db } from '../firebase';
import { getReportWithMedia } from '../services/reportStorageService';
import { ArrowLeft, Edit2, Printer, X, ChevronLeft, ChevronRight, Download, Eye, Cloud, FileText, Image as ImageIcon, Layers } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import toast from 'react-hot-toast';
import { getGoogleAccessToken, createDriveFolder, uploadImageToDrive, uploadTextToDrive } from '../services/driveService';
import { requestDriveAccess } from '../services/authService';
import CoverQrBadge from './CoverQrBadge';
import { getCoverQrHtmlBadge, getBackCoverQrHtmlBadge, generateQrDataUrl, getReportDigitalUrl } from '../utils/qrCodeHelper';

const trimmedCache = new Map<string, string>();

function trimImageWhitespace(imgUrl: string): Promise<string> {
  if (!imgUrl) return Promise.resolve(imgUrl);
  if (trimmedCache.has(imgUrl)) {
    return Promise.resolve(trimmedCache.get(imgUrl)!);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(imgUrl);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const w = canvas.width;
        const h = canvas.height;
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;

        let minX = w, minY = h, maxX = 0, maxY = 0;
        let hasContent = false;

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const a = data[idx + 3];
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];

            const isTransparent = a < 25;
            const isWhite = r > 245 && g > 245 && b > 245 && a > 200;

            if (!isTransparent && !isWhite) {
              hasContent = true;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        if (!hasContent || minX >= maxX || minY >= maxY) {
          trimmedCache.set(imgUrl, imgUrl);
          resolve(imgUrl);
          return;
        }

        const pad = Math.max(2, Math.round(Math.min(w, h) * 0.02));
        const cropX = Math.max(0, minX - pad);
        const cropY = Math.max(0, minY - pad);
        const cropW = Math.min(w - cropX, (maxX - minX) + pad * 2);
        const cropH = Math.min(h - cropY, (maxY - minY) + pad * 2);

        if (cropW < w * 0.94 || cropH < h * 0.94) {
          const croppedCanvas = document.createElement('canvas');
          croppedCanvas.width = cropW;
          croppedCanvas.height = cropH;
          const croppedCtx = croppedCanvas.getContext('2d');
          if (croppedCtx) {
            croppedCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
            const trimmedUrl = croppedCanvas.toDataURL('image/png');
            trimmedCache.set(imgUrl, trimmedUrl);
            resolve(trimmedUrl);
            return;
          }
        }
        trimmedCache.set(imgUrl, imgUrl);
        resolve(imgUrl);
      } catch (e) {
        resolve(imgUrl);
      }
    };
    img.onerror = () => resolve(imgUrl);
    img.src = imgUrl;
  });
}

function SmartCoverLogo({ 
  src, 
  alt, 
  userScale = 1.0, 
  baseHeight = 56, 
  isCurtin = false,
  isKpm = false,
  isYayasan = false
}: { 
  src: string; 
  alt: string; 
  userScale?: number; 
  baseHeight?: number; 
  isCurtin?: boolean;
  isKpm?: boolean;
  isYayasan?: boolean;
  key?: React.Key 
}) {
  const [displaySrc, setDisplaySrc] = useState(src);
  const [aspectRatio, setAspectRatio] = useState<number>(1);

  useEffect(() => {
    let active = true;
    trimImageWhitespace(src).then((res) => {
      if (active) {
        setDisplaySrc(res);
        const img = new Image();
        img.onload = () => {
          if (active && img.naturalHeight > 0) {
            setAspectRatio(img.naturalWidth / img.naturalHeight);
          }
        };
        img.src = res;
      }
    });
    return () => { active = false; };
  }, [src]);

  // Optical sizing for balanced visual weight:
  // 1. Curtin University Malaysia: wide banner logo. Scaled down to height ~32px, max-width ~125px to match circular visual area.
  // 2. KPM (Jata Negara with "KEMENTERIAN PENDIDIKAN"): dignified central height ~58px, max-width ~80px.
  // 3. Yayasan Sarawak: height ~52px, max-width ~80px.
  // 4. PIBG and SK Tudan: matching circular emblems, height ~56px.
  let optHeight = baseHeight;
  let optMaxW = 75;

  if (isCurtin || aspectRatio > 2.2) {
    optHeight = Math.round(baseHeight * 0.57); // ~32px
    optMaxW = 125;
  } else if (isKpm) {
    optHeight = Math.round(baseHeight * 1.04); // ~58px
    optMaxW = 80;
  } else if (isYayasan || aspectRatio > 1.25) {
    optHeight = Math.round(baseHeight * 0.93); // ~52px
    optMaxW = 80;
  }

  const finalHeight = Math.round(optHeight * (userScale || 1.0));
  const finalMaxW = Math.round(optMaxW * (userScale || 1.0));

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: `${finalHeight}px`,
        maxWidth: `${finalMaxW}px`,
        flexShrink: 0,
      }}
    >
      <img
        src={displaySrc}
        alt={alt}
        style={{
          height: `${finalHeight}px`,
          maxHeight: `${finalHeight}px`,
          width: 'auto',
          maxWidth: `${finalMaxW}px`,
          objectFit: 'contain',
          imageRendering: '-webkit-optimize-contrast',
          display: 'block',
        }}
      />
    </div>
  );
}

interface ReportDetailProps {
  reportId: string;
  onBack: () => void;
  onEdit: () => void;
  onViewPdf?: () => void;
}

export default function ReportDetail({ reportId, onBack, onEdit, onViewPdf }: ReportDetailProps) {
  const [report, setReport] = useState<any>(null);
  const [coverTemplate, setCoverTemplate] = useState<string>('');
  const [backCoverTemplate, setBackCoverTemplate] = useState<string>('');
  const [systemLogos, setSystemLogos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [activeTab, setActiveTab] = useState<'opr' | 'cover' | 'all' | 'back'>('all');
  const [printScope, setPrintScope] = useState<'opr' | 'all'>('all');
  const [showPrintSettings, setShowPrintSettings] = useState(false);
  const [printAction, setPrintAction] = useState<'pdf' | 'print' | null>(null);
  const [printSize, setPrintSize] = useState<'a4' | 'letter'>('a4');
  const [printOrientation, setPrintOrientation] = useState<'p' | 'l'>('p');
  const [printMargin, setPrintMargin] = useState('12mm');
  const reportRef = useRef<HTMLDivElement>(null);
  const oprRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchReportAndSettings = async () => {
      try {
        // Fetch Settings
        try {
          const settingsRef = doc(db, 'settings', 'global');
          const settingsSnap = await getDoc(settingsRef);
          if (settingsSnap.exists()) {
            const data = settingsSnap.data();
            setCoverTemplate(data.coverTemplate || '');
            setBackCoverTemplate(data.backCoverTemplate || '');
            if (data.coverTemplate) localStorage.setItem('cachedCoverTemplate', data.coverTemplate);
            if (data.backCoverTemplate) localStorage.setItem('cachedBackCoverTemplate', data.backCoverTemplate);
            if (Array.isArray(data.logos)) {
              setSystemLogos(data.logos);
              localStorage.setItem('cachedSystemLogos', JSON.stringify(data.logos));
            }
          }
        } catch (err) {
          console.error("Error fetching settings:", err);
        }

        const fullReport = await getReportWithMedia(reportId);
        if (fullReport) {
          setReport(fullReport);
          // Auto-open PDF presentation mode if accessed via QR code with format=pdf
          if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            if (params.get('format') === 'pdf' || params.get('view') === 'pdf' || params.get('pdf') === '1') {
              if (onViewPdf) {
                onViewPdf();
              } else {
                setShowPreview(true);
              }
              toast('Memaparkan Dokumen OPR dalam Format PDF.', { icon: '📄', duration: 3500 });
            }
          }
        }
      } catch (error) {
        console.error("Error fetching report:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchReportAndSettings();
  }, [reportId]);

  if (loading) {
    return <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>;
  }

  if (!report) {
    return <div className="text-center p-8 text-gray-500">Report not found.</div>;
  }

  const cachedCover = typeof window !== 'undefined' ? (localStorage.getItem('cachedCoverTemplate') || '') : '';
  const cachedBackCover = typeof window !== 'undefined' ? (localStorage.getItem('cachedBackCoverTemplate') || '') : '';
  const activeCover = report?.gambarMukaDepan || coverTemplate || cachedCover;
  const activeBackCover = report?.gambarMukaBelakang || backCoverTemplate || cachedBackCover;

  const activeLogos: string[] = (Array.isArray(report?.logos) && report.logos.some((l: string) => l && l.trim() !== ''))
    ? report.logos.filter((l: string) => l && l.trim() !== '')
    : (Array.isArray(systemLogos) && systemLogos.some((l: string) => l && l.trim() !== ''))
      ? systemLogos.filter((l: string) => l && l.trim() !== '')
      : (report?.logoSekolah ? [report.logoSekolah] : []);
  
  const handlePrintToPdf = () => {
    toast('Membuka dialog cetakan PDF (A4)... Sila pilih destinasi "Save as PDF".', {
      icon: '🖨️',
      duration: 3500,
    });
    setTimeout(() => {
      window.print();
    }, 200);
  };

  const handlePrint = () => {
    setPrintAction('print');
    setShowPrintSettings(true);
  };

  const executePrint = () => {
    setShowPrintSettings(false);
    const targetElement = printScope === 'opr' ? (oprRef.current || reportRef.current) : reportRef.current;
    if (!targetElement) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast('Membuka dialog cetakan...', { icon: '🖨️' });
      window.print();
      return;
    }
    
    const htmlContent = targetElement.innerHTML;
    const styleTags = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map(tag => tag.outerHTML)
      .join('\n');
      
    const pageCss = `
      @page {
        size: ${printSize} ${printOrientation === 'l' ? 'landscape' : 'portrait'};
        margin: 0 !important;
      }
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        background-color: white;
        margin: 0 !important;
        padding: 0 !important;
      }
      .cover-page-container {
        width: 100% !important;
        height: 100vh !important;
        min-height: 297mm !important;
        max-height: 297mm !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        page-break-after: always !important;
        break-after: page !important;
        box-sizing: border-box !important;
      }
      .back-cover-page-container {
        width: 100% !important;
        height: 100vh !important;
        min-height: 297mm !important;
        max-height: 297mm !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        page-break-before: always !important;
        break-before: page !important;
        box-sizing: border-box !important;
      }
      .opr-page-container {
        padding: ${printMargin && printMargin !== '0mm' ? printMargin : '25.4mm 12mm 10mm 12mm'} !important;
        box-sizing: border-box !important;
        margin: 0 auto !important;
        width: 100% !important;
        max-width: 210mm !important;
        color: #000000 !important;
      }
      /* Pastikan semua font maklumat OPR dan teks laporan adalah berwarna hitam pekat */
      body,
      .opr-page-container,
      .opr-page-container *,
      .opr-page-container table,
      .opr-page-container th,
      .opr-page-container td,
      .opr-page-container p,
      .opr-page-container span,
      .opr-page-container pre,
      .opr-page-container h1,
      .opr-page-container h2,
      .opr-page-container h3,
      .cover-page-container p,
      .cover-page-container span,
      .cover-page-container td,
      .cover-page-container th,
      .back-cover-page-container p,
      .back-cover-page-container span,
      .back-cover-page-container h1,
      .back-cover-page-container h2 {
        color: #000000 !important;
        -webkit-text-fill-color: #000000 !important;
      }
      .opr-page-container table {
        border-color: #000000 !important;
      }
      .opr-page-container th,
      .opr-page-container td {
        border-color: #000000 !important;
      }
    `;

    printWindow.document.write(`
      <html>
        <head>
          <title>Cetak Laporan</title>
          ${styleTags}
          <style>${pageCss}</style>
        </head>
        <body class="bg-white">
          <div style="width: 100%; height: 100%;">
            ${htmlContent}
          </div>
          <script>
            window.onload = () => {
              setTimeout(() => {
                window.print();
                window.close();
              }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleDownloadPdfClick = () => {
    setPrintAction('pdf');
    setShowPrintSettings(true);
  };

  const executeDownloadPdf = async () => {
    toast('Sila pilih "Save as PDF" semasa mencetak.', {
      icon: '📄',
      duration: 5000,
    });
    return executePrint();
  };

  const handleDownloadWord = () => {
    if (!report) return;

    const htmlContent = `
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>${report.namaProgram}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.15; color: #000; padding: 0; margin: 0; }
  .header { text-align: center; margin-bottom: 5px; }
  .school-info { text-align: center; font-weight: bold; font-size: 11pt; line-height: 1.15; margin-bottom: 0; }
  .header h1 { font-size: 11pt; text-decoration: underline; margin: 2px 0 0px; font-weight: bold; }
  .header h2 { font-size: 11pt; text-transform: uppercase; margin: 0; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 5px; font-size: 11pt; line-height: 1.15; font-family: Arial, Helvetica, sans-serif; }
  th, td { border: 1px solid #000; padding: 2px 4px; vertical-align: top; }
  th { background-color: #f6f6f6; font-weight: bold; text-align: center; }
  .col-bil { width: 5%; text-align: center; font-weight: bold; }
  .col-perkara { width: 22%; font-weight: bold; }
  .col-maklumat { width: auto; text-align: justify; }
  pre { font-family: inherit; margin: 0; white-space: pre-wrap; font-size: inherit; text-align: justify; }
  .images-grid { text-align: center; }
  .image-container { display: inline-block; width: 45%; margin: 2%; vertical-align: top; text-align: center; }
  .image-box img { max-width: 100%; max-height: 100px; }
  .image-desc { font-size: 9pt; font-family: Arial, sans-serif; margin-top: 5px; line-height: 1.0; }
</style>
</head>
<body>
  ${activeCover ? `
    <div style="text-align: center; margin-bottom: 30px; page-break-after: always; position: relative;">
      <img src="${activeCover}" style="max-width: 100%; height: auto;" />
      ${activeLogos.length > 0 ? `
        <div style="position: absolute; top: 4.8%; left: 0; right: 0; display: flex; justify-content: center; align-items: center; flex-wrap: nowrap; gap: ${activeLogos.length > 4 ? '32px' : '36px'}; width: 100%; height: 76px; pointer-events: none; z-index: 20;">
          ${activeLogos.map((l: string, idx: number) => {
            const isKpmLogo = idx === 2 || l.toLowerCase().includes('kpm') || l.toLowerCase().includes('kementerian') || l.toLowerCase().includes('pendidikan');
            const isYayasan = idx === 3 || l.toLowerCase().includes('yayasan') || l.toLowerCase().includes('sarawak');
            const isCurtin = idx === 4 || l.toLowerCase().includes('curtin');
            const userScale = report?.logoScales?.[idx] || 1.0;
            const h = Math.round((isCurtin ? 32 : (isKpmLogo ? 56 : (isYayasan ? 50 : 54))) * userScale);
            const maxW = Math.round((isCurtin ? 120 : (isKpmLogo || isYayasan ? 78 : 75)) * userScale);
            return `<div style="display: inline-flex; align-items: center; justify-content: center; height: ${h}px; max-width: ${maxW}px; flex-shrink: 0;"><img src="${l}" alt="Logo ${idx + 1}" style="height: ${h}px; max-height: ${h}px; width: auto; max-width: ${maxW}px; object-fit: contain; display: inline-block; vertical-align: middle;" /></div>`;
          }).join('')}
        </div>
      ` : ''}
      <div style="width: 85%; margin: 25px auto; border: 1.5px solid #1e3a8a; border-radius: 6px; padding: 15px 20px; text-align: left; background-color: #f8fafc;">
        <table style="width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.6;">
          <tr>
            <td style="width: 32%; font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">Nama Program</td>
            <td style="width: 4%; font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">:</td>
            <td style="width: 64%; font-weight: bold; text-transform: uppercase; vertical-align: top; padding: 4px 0; border: none;">${report.namaProgram || report.singkatanProgram || report.namaLaporan || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">Tarikh Pelaksanaan</td>
            <td style="font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">:</td>
            <td style="vertical-align: top; padding: 4px 0; border: none;">${report.tarikhPelaksanaan || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">Tempat Pelaksanaan</td>
            <td style="font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">:</td>
            <td style="vertical-align: top; padding: 4px 0; border: none;">${report.tempat || '-'}</td>
          </tr>
        </table>
      </div>
      <br clear="all" style="page-break-before:always" />
    </div>
  ` : `
    <div style="text-align: center; margin-bottom: 40px; page-break-after: always; padding: 20px 0;">
      ${activeLogos.length > 0 ? `
        <div style="text-align: center; margin-bottom: 20px; white-space: nowrap;">
          ${activeLogos.map((l: string, idx: number) => `
            <img src="${l}" alt="Logo ${idx + 1}" style="height: 54px; max-height: 54px; width: auto; max-width: 85px; object-fit: contain; margin: 0 8px; display: inline-block; vertical-align: middle;" />
          `).join('')}
        </div>
      ` : ''}
      <div style="line-height: 1.2; margin-bottom: 20px;">
        <h1 style="font-size: 15pt; margin: 0; font-weight: bold; text-transform: uppercase;">ONE PAGE REPORT (OPR)</h1>
        <p style="font-size: 11pt; margin: 4px 0 0; font-weight: bold; color: #1e3a8a; text-transform: uppercase;">SEKOLAH KEBANGSAAN TUDAN, MIRI</p>
        <h2 style="font-size: 13pt; margin: 10px 0 0; font-weight: bold; color: #111827; text-transform: uppercase;">${report.namaProgram || report.namaLaporan || ''}</h2>
      </div>
      ${report.gambarProgram && report.gambarProgram.length > 0 ? `<img src="${report.gambarProgram[0]}" style="max-height: 280px; width: 70%; object-fit: cover; margin-bottom: 25px; border-radius: 6px;" />` : `<br/><br/>`}
      <div style="width: 85%; margin: 20px auto; border: 1.5px solid #1e3a8a; border-radius: 6px; padding: 15px 20px; text-align: left; background-color: #f8fafc;">
        <table style="width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.6;">
          <tr>
            <td style="width: 32%; font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">Nama Program</td>
            <td style="width: 4%; font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">:</td>
            <td style="width: 64%; font-weight: bold; text-transform: uppercase; vertical-align: top; padding: 4px 0; border: none;">${report.namaProgram || report.namaLaporan || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">Tarikh Pelaksanaan</td>
            <td style="font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">:</td>
            <td style="vertical-align: top; padding: 4px 0; border: none;">${report.tarikhPelaksanaan || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">Tempat Pelaksanaan</td>
            <td style="font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">:</td>
            <td style="vertical-align: top; padding: 4px 0; border: none;">${report.tempat || '-'}</td>
          </tr>
          ${report.anjuran ? `
            <tr>
              <td style="font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">Anjuran</td>
              <td style="font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">:</td>
              <td style="vertical-align: top; padding: 4px 0; border: none;">${report.anjuran}</td>
            </tr>
          ` : ''}
        </table>
      </div>
      <br clear="all" style="page-break-before:always" />
    </div>
  `}
  <div style="text-align: center; margin-top: 1in; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid #000;">
    <h2 style="font-size: 12pt; font-weight: bold; text-transform: uppercase; margin: 0; line-height: 1.15; font-family: Arial, sans-serif;">ONE PAGE REPORT (OPR)</h2>
    <p style="font-size: 10pt; font-weight: bold; text-transform: uppercase; margin: 2px 0 0; line-height: 1.15; font-family: Arial, sans-serif;">SEKOLAH KEBANGSAAN TUDAN, MIRI</p>
  </div>
  <table>
    <thead>
      <tr>
        <th class="col-bil">BIL</th>
        <th class="col-perkara">PERKARA</th>
        <th class="col-maklumat">MAKLUMAT</th>
      </tr>
    </thead>
    <tbody>
      <tr style="page-break-inside: avoid; break-inside: avoid;"><td class="col-bil">1</td><td class="col-perkara">Nama Program</td><td class="col-maklumat">${report.namaProgram}</td></tr>
      <tr style="page-break-inside: avoid; break-inside: avoid;"><td class="col-bil">2</td><td class="col-perkara">Tarikh Pelaksanaan</td><td class="col-maklumat">${report.tarikhPelaksanaan}</td></tr>
      <tr style="page-break-inside: avoid; break-inside: avoid;"><td class="col-bil">3</td><td class="col-perkara">Sasaran</td><td class="col-maklumat">${report.sasaran}</td></tr>
      <tr style="page-break-inside: avoid; break-inside: avoid;"><td class="col-bil">4</td><td class="col-perkara">Anjuran</td><td class="col-maklumat">${report.anjuran}</td></tr>
      <tr style="page-break-inside: avoid; break-inside: avoid;"><td class="col-bil">5</td><td class="col-perkara">Objektif</td><td class="col-maklumat"><pre>${report.objektif}</pre></td></tr>
      <tr style="page-break-inside: avoid; break-inside: avoid;"><td class="col-bil">6</td><td class="col-perkara">Kekuatan</td><td class="col-maklumat"><pre>${report.kekuatan}</pre></td></tr>
      <tr style="page-break-inside: avoid; break-inside: avoid;"><td class="col-bil">7</td><td class="col-perkara">Perkara Perlu Penambahbaikan</td><td class="col-maklumat"><pre>${report.perkaraPerluPenambahbaikan}</pre></td></tr>
      <tr style="page-break-inside: avoid; break-inside: avoid;"><td class="col-bil">8</td><td class="col-perkara">Cadangan Penambahbaikan</td><td class="col-maklumat"><pre>${report.cadanganPenambahbaikan}</pre></td></tr>
      ${report.penilaianKeberkesanan ? `
        <tr style="page-break-inside: avoid; break-inside: avoid;"><td class="col-bil">9</td><td class="col-perkara">Penilaian Keberkesanan</td><td class="col-maklumat"><pre>${report.penilaianKeberkesanan}</pre></td></tr>
      ` : ''}
      <tr style="page-break-inside: avoid; break-inside: avoid;">
        <td class="col-bil">${report.penilaianKeberkesanan ? '10' : '9'}</td>
        <td class="col-perkara">Gambar Pelaksanaan</td>
        <td class="col-maklumat" style="line-height: 1.0;">
          <table style="width: 100%; border: none; margin: 0; padding: 0;">
            ${(report.gambarProgram || []).reduce((acc: string[], img: string, i: number) => {
              if (i % 2 === 0) {
                const nextImg = report.gambarProgram[i + 1];
                acc.push(`
                  <tr>
                    <td style="width: 50%; border: none; text-align: center; vertical-align: top; padding: 0;">
                      <img src="${img}" style="max-width: 100%; max-height: 75px; object-fit: contain;" alt="Gambar ${i+1}"/>
                      ${report.peneranganGambar && report.peneranganGambar[i] ? `<p style="font-size: 9pt; font-family: Arial, sans-serif; margin: 0; line-height: 1.0; text-align: center;">${report.peneranganGambar[i]}</p>` : ''}
                    </td>
                    <td style="width: 50%; border: none; text-align: center; vertical-align: top; padding: 0;">
                      ${nextImg ? `
                        <img src="${nextImg}" style="max-width: 100%; max-height: 75px; object-fit: contain;" alt="Gambar ${i+2}"/>
                        ${report.peneranganGambar && report.peneranganGambar[i+1] ? `<p style="font-size: 9pt; font-family: Arial, sans-serif; margin: 0; line-height: 1.0; text-align: center;">${report.peneranganGambar[i+1]}</p>` : ''}
                      ` : ''}
                    </td>
                  </tr>
                `);
              }
              return acc;
            }, []).join('')}
          </table>
        </td>
      </tr>
    </tbody>
  </table>
  <br/>
  <table style="border: none; margin-top: 20px; page-break-inside: avoid;">
    <tr>
      <td style="border: none; width: 50%; padding-right: 20px; vertical-align: top;">
        <p style="margin-bottom: 0.8cm;">Disediakan oleh:</p>
        <div style="border-top: 1px solid black; padding-top: 4px;">
          <p style="margin: 0; font-weight: bold; text-transform: uppercase; line-height: 1.0;">${report.disediakanOleh || ' '}</p>
          <p style="margin: 0; line-height: 1.0;">${report.jawatanDisediakanOleh || ' '}</p>
        </div>
      </td>
      <td style="border: none; width: 50%; padding-left: 20px; vertical-align: top;">
        <p style="margin-bottom: 0.8cm;">Disahkan oleh:</p>
        <div style="border-top: 1px solid black; padding-top: 4px;">
          <p style="margin: 0; font-weight: bold; text-transform: uppercase; line-height: 1.0;">${report.disahkanOleh || ' '}</p>
          <p style="margin: 0; line-height: 1.0;">${report.jawatanDisahkanOleh || ' '}</p>
        </div>
      </td>
    </tr>
  </table>
  <br clear="all" style="page-break-before:always;" />
  ${activeBackCover ? `
    <div style="text-align: center; page-break-before: always; margin-top: 20px;">
      <img src="${activeBackCover}" style="max-width: 100%; height: auto;" alt="Muka Belakang" />
    </div>
  ` : `
    <div style="text-align: center; page-break-before: always; padding: 60px 20px; font-family: Arial, sans-serif;">
      <p style="font-size: 10pt; font-weight: bold; text-transform: uppercase; color: #666; margin: 0;">KEMENTERIAN PENDIDIKAN MALAYSIA</p>
      <p style="font-size: 11pt; font-weight: bold; text-transform: uppercase; color: #333; margin: 4px 0 0;">JABATAN PENDIDIKAN NEGERI SARAWAK</p>
      <p style="font-size: 10pt; text-transform: uppercase; color: #666; margin: 2px 0 20px;">PEJABAT PENDIDIKAN DAERAH MIRI</p>
      
      ${activeLogos.length > 0 ? `
        <div style="text-align: center; margin: 30px 0;">
          <img src="${activeLogos[0]}" alt="Logo Sekolah" style="height: 85px; max-height: 85px; width: auto; max-width: 120px; object-fit: contain; display: inline-block;" />
        </div>
      ` : ''}

      <h2 style="font-size: 15pt; font-weight: bold; text-transform: uppercase; margin: 10px 0 0; color: #111827;">SEKOLAH KEBANGSAAN TUDAN</h2>
      <p style="font-size: 11pt; font-weight: bold; text-transform: uppercase; color: #1e3a8a; margin: 4px 0 25px;">MIRI, SARAWAK</p>
      
      <div style="width: 80%; margin: 30px auto; border: 1.5px solid #1e3a8a; border-radius: 6px; padding: 15px 20px; text-align: center; background-color: #f8fafc;">
        <p style="font-size: 9pt; font-weight: bold; text-transform: uppercase; color: #666; margin: 0;">DOKUMEN DOKUMENTASI RASMI</p>
        <h3 style="font-size: 12pt; font-weight: bold; text-transform: uppercase; margin: 6px 0 0; color: #111827;">ONE PAGE REPORT (OPR)</h3>
        <p style="font-size: 10pt; margin: 10px 0 0; font-weight: bold; text-transform: uppercase; color: #1e3a8a;">${report.namaProgram || report.namaLaporan || '-'}</p>
        <p style="font-size: 10pt; margin: 4px 0 0; color: #333;">Tarikh: ${report.tarikhPelaksanaan || '-'}</p>
        <p style="font-size: 10pt; margin: 4px 0 0; color: #333;">Tempat: ${report.tempat || '-'}</p>
      </div>

      <div style="margin-top: 50px;">
        <p style="font-size: 10pt; font-style: italic; color: #555; margin: 0;">"Pendidikan Berkualiti Insan Terdidik Negara Sejahtera"</p>
        <p style="font-size: 8pt; text-transform: uppercase; color: #888; margin-top: 15px;">Dijana Secara Automatik Oleh Sistem Pengurusan OPR Sekolah</p>
      </div>
    </div>
  `}
</body>
</html>
    `;

    const blob = new Blob(['\ufeff', htmlContent], {
      type: 'application/msword'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const fileName = `${(report.namaLaporan || report.namaProgram || 'Laporan').replace(/[^a-zA-Z0-9]/g, '_')}.doc`;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Fail Word berjaya dimuat turun!');
  };

  const handleNextImage = () => {
    if (report?.gambarProgram) {
      setSelectedImageIndex((prev) => prev === null ? null : (prev + 1) % report.gambarProgram.length);
    }
  };

  const handlePrevImage = () => {
    if (report?.gambarProgram) {
      setSelectedImageIndex((prev) => prev === null ? null : (prev - 1 + report.gambarProgram.length) % report.gambarProgram.length);
    }
  };

  const handleExportDrive = async () => {
    let accessToken = await requestDriveAccess();

    if (!accessToken) {
      toast.error("Gagal mendapat sambungan ke Google Drive. Sila benarkan akses.");
      return;
    }

    const toastId = toast.loading('Mengeksport ke Google Drive...');
    try {
      const folderName = report.namaLaporan || `Laporan - ${report.namaProgram || 'Tanpa Nama'}`;
      const folderId = await createDriveFolder(accessToken, folderName);

      // 1. Upload Images
      const uploadPromises = (report.gambarProgram || []).map((url: string, index: number) => {
        if (!url) return Promise.resolve();
        const filename = `Gambar_${index + 1}.jpg`;
        return uploadImageToDrive(accessToken, url, filename, folderId);
      });

      if (activeBackCover) {
        uploadPromises.push(uploadImageToDrive(accessToken, activeBackCover, 'Cover_Belakang.jpg', folderId));
      }

      await Promise.all(uploadPromises);

      // 2. Generate QR code for document
      const qrDataUrl = await generateQrDataUrl(getReportDigitalUrl(report.id || reportId, report.namaProgram));

      // 3. Generate and Upload Document
      const docHtml = `
<html>
<head>
<style>
  @page { margin: 10mm; size: A4 portrait; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.15; color: #000; padding: 0; margin: 0; }
  .header { text-align: center; margin-bottom: 5px; }
  .logos-container { display: flex; justify-content: center; align-items: center; gap: 20px; margin-bottom: 5px; }
  .logo-img { height: 80px; object-fit: contain; }
  .school-info { text-align: center; font-weight: bold; font-size: 11pt; line-height: 1.15; margin-bottom: 0; }
  .school-info p { margin: 0; padding: 0; text-transform: uppercase; }
  .header h1 { font-size: 11pt; text-decoration: underline; margin: 2px 0 0px; font-weight: bold; }
  .header h2 { font-size: 11pt; text-transform: uppercase; margin: 0; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 5px; font-size: 11pt; line-height: 1.15; font-family: Arial, Helvetica, sans-serif; }
  th, td { border: 1px solid #000; padding: 2px 4px; vertical-align: top; }
  th { background-color: #f6f6f6; font-weight: bold; text-align: center; }
  .col-bil { width: 5%; text-align: center; font-weight: bold; }
  .col-perkara { width: 22%; font-weight: bold; }
  .col-maklumat { width: auto; text-align: justify; }
  pre { font-family: inherit; margin: 0; white-space: pre-wrap; font-size: inherit; text-align: justify; }
  .images-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 10px; }
  .image-box { border: 1px dashed #999; height: 100px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .image-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .image-desc { font-size: 9pt; font-family: Arial, sans-serif; text-align: center; margin: 0; line-height: 1.0; }
  .footer { display: flex; justify-content: space-between; margin-top: 15px; padding: 0 20px; page-break-inside: avoid; }
  .sign-box { text-align: left; width: 45%; }
  .name { font-weight: bold; text-transform: uppercase; }
</style>
</head>
<body>
  ${activeCover ? `
    <div style="text-align: center; margin: 0; padding: 0; page-break-after: always; break-after: page; position: relative; width: 100%; min-height: 297mm; max-height: 297mm; overflow: hidden;">
      <img src="${activeCover}" style="width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0;" />
      ${activeLogos.length > 0 ? `
        <div style="position: absolute; top: 4.8%; left: 0; right: 0; display: flex; justify-content: center; align-items: center; flex-wrap: nowrap; gap: ${activeLogos.length > 4 ? '32px' : '36px'}; width: 100%; height: 76px; pointer-events: none; z-index: 20;">
          ${activeLogos.map((l: string, idx: number) => {
            const isKpmLogo = idx === 2 || l.toLowerCase().includes('kpm') || l.toLowerCase().includes('kementerian') || l.toLowerCase().includes('pendidikan');
            const isYayasan = idx === 3 || l.toLowerCase().includes('yayasan') || l.toLowerCase().includes('sarawak');
            const isCurtin = idx === 4 || l.toLowerCase().includes('curtin');
            const userScale = report?.logoScales?.[idx] || 1.0;
            const h = Math.round((isCurtin ? 32 : (isKpmLogo ? 56 : (isYayasan ? 50 : 54))) * userScale);
            const maxW = Math.round((isCurtin ? 120 : (isKpmLogo || isYayasan ? 78 : 75)) * userScale);
            return `<div style="display: inline-flex; align-items: center; justify-content: center; height: ${h}px; max-width: ${maxW}px; flex-shrink: 0;"><img src="${l}" alt="Logo ${idx + 1}" style="height: ${h}px; max-height: ${h}px; width: auto; max-width: ${maxW}px; object-fit: contain; display: inline-block; vertical-align: middle;" /></div>`;
          }).join('')}
        </div>
      ` : ''}
      <div style="position: absolute; top: 47.6%; left: 34.5%; width: 60.0%; height: 6.4%; display: flex; align-items: center; justify-content: center; padding: 0 16px; box-sizing: border-box; text-align: center; pointer-events: none; z-index: 10;">
         <p style="font-family: Arial, sans-serif; font-weight: bold; color: #000000; margin: 0; font-size: 11.5pt; text-transform: uppercase; text-align: center; width: 100%; overflow: hidden; line-height: 1.25; letter-spacing: 0.01em;">${(report.namaProgram || report.singkatanProgram || report.namaLaporan || '').toUpperCase()}</p>
      </div>
      <div style="position: absolute; top: 56.8%; left: 34.5%; width: 60.0%; height: 6.4%; display: flex; align-items: center; justify-content: center; padding: 0 16px; box-sizing: border-box; text-align: center; pointer-events: none; z-index: 10;">
         <p style="font-family: Arial, sans-serif; font-weight: bold; color: #000000; margin: 0; font-size: 12pt; text-align: center; width: 100%; text-transform: uppercase;">${(report.tarikhPelaksanaan || '-').toUpperCase()}</p>
      </div>
      <div style="position: absolute; top: 66.0%; left: 34.5%; width: 60.0%; height: 6.4%; display: flex; align-items: center; justify-content: center; padding: 0 16px; box-sizing: border-box; text-align: center; pointer-events: none; z-index: 10;">
         <p style="font-family: Arial, sans-serif; font-weight: bold; color: #000000; margin: 0; font-size: 12pt; text-align: center; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: uppercase;">${(report.tempat || '-').toUpperCase()}</p>
      </div>
      <div style="position: absolute; bottom: 0.4%; left: 1.5%; display: flex; align-items: center; justify-content: flex-start; pointer-events: none; z-index: 20;">
        ${getCoverQrHtmlBadge(report.id || reportId, report.namaProgram || report.singkatanProgram || report.namaLaporan || '', qrDataUrl)}
      </div>
      <br clear="all" style="page-break-after:always; display:none;" />
    </div>
  ` : `
    <div style="text-align: center; margin-bottom: 40px; page-break-after: always; padding: 20px 0;">
      ${activeLogos.length > 0 ? `
        <div style="display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 32px; margin-bottom: 22px; width: 100%; flex-wrap: nowrap; overflow: hidden;">
          ${activeLogos.map((l: string, idx: number) => {
            const isKpmLogo = idx === 2 || l.toLowerCase().includes('kpm') || l.toLowerCase().includes('kementerian') || l.toLowerCase().includes('pendidikan');
            const isYayasan = idx === 3 || l.toLowerCase().includes('yayasan') || l.toLowerCase().includes('sarawak');
            const isCurtin = idx === 4 || l.toLowerCase().includes('curtin');
            const userScale = report?.logoScales?.[idx] || 1.0;
            const h = Math.round((isCurtin ? 32 : (isKpmLogo ? 56 : (isYayasan ? 50 : 54))) * userScale);
            const maxW = Math.round((isCurtin ? 120 : (isKpmLogo || isYayasan ? 78 : 75)) * userScale);
            return `<div style="display: inline-flex; align-items: center; justify-content: center; height: ${h}px; max-width: ${maxW}px; flex-shrink: 0;"><img src="${l}" alt="Logo ${idx + 1}" style="height: ${h}px; max-height: ${h}px; width: auto; max-width: ${maxW}px; object-fit: contain; display: inline-block; vertical-align: middle;" /></div>`;
          }).join('')}
        </div>
      ` : ''}
      <div style="line-height: 1.2; margin-bottom: 20px;">
        <h1 style="font-size: 15pt; margin: 0; font-weight: bold; text-transform: uppercase;">ONE PAGE REPORT (OPR)</h1>
        <p style="font-size: 11pt; margin: 4px 0 0; font-weight: bold; color: #1e3a8a; text-transform: uppercase;">SEKOLAH KEBANGSAAN TUDAN, MIRI</p>
        <h2 style="font-size: 13pt; margin: 10px 0 0; font-weight: bold; color: #111827; text-transform: uppercase;">${report.namaProgram || report.namaLaporan || ''}</h2>
      </div>
      ${report.gambarProgram && report.gambarProgram.length > 0 ? `<img src="${report.gambarProgram[0]}" style="max-height: 280px; width: 70%; object-fit: cover; margin-bottom: 25px; border-radius: 6px;" />` : `<br/><br/>`}
      <div style="width: 85%; margin: 20px auto; border: 1.5px solid #1e3a8a; border-radius: 6px; padding: 15px 20px; text-align: left; background-color: #f8fafc;">
        <table style="width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.6;">
          <tr>
            <td style="width: 32%; font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">Nama Program</td>
            <td style="width: 4%; font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">:</td>
            <td style="width: 64%; font-weight: bold; text-transform: uppercase; vertical-align: top; padding: 4px 0; border: none;">${report.namaProgram || report.namaLaporan || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">Tarikh Pelaksanaan</td>
            <td style="font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">:</td>
            <td style="vertical-align: top; padding: 4px 0; border: none;">${report.tarikhPelaksanaan || '-'}</td>
          </tr>
          <tr>
            <td style="font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">Tempat Pelaksanaan</td>
            <td style="font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">:</td>
            <td style="vertical-align: top; padding: 4px 0; border: none;">${report.tempat || '-'}</td>
          </tr>
          ${report.anjuran ? `
            <tr>
              <td style="font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">Anjuran</td>
              <td style="font-weight: bold; color: #1e3a8a; vertical-align: top; padding: 4px 0; border: none;">:</td>
              <td style="vertical-align: top; padding: 4px 0; border: none;">${report.anjuran}</td>
            </tr>
          ` : ''}
        </table>
      </div>
      <div style="margin-top: 25px; display: flex; justify-content: center; width: 100%;">
        ${getCoverQrHtmlBadge(report.id || reportId, report.namaProgram || report.singkatanProgram || report.namaLaporan || '', qrDataUrl)}
      </div>
      <br clear="all" style="page-break-before:always" />
    </div>
  `}
  <div style="text-align: center; margin-top: 1in; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid #000;">
    <h2 style="font-size: 12pt; font-weight: bold; text-transform: uppercase; margin: 0; line-height: 1.15; font-family: Arial, sans-serif;">ONE PAGE REPORT (OPR)</h2>
    <p style="font-size: 10pt; font-weight: bold; text-transform: uppercase; margin: 2px 0 0; line-height: 1.15; font-family: Arial, sans-serif;">SEKOLAH KEBANGSAAN TUDAN, MIRI</p>
  </div>
  <table>
    <thead>
      <tr>
        <th class="col-bil">BIL</th>
        <th class="col-perkara">PERKARA</th>
        <th class="col-maklumat">MAKLUMAT</th>
      </tr>
    </thead>
    <tbody>
      <tr style="page-break-inside: avoid; break-inside: avoid;"><td class="col-bil">1</td><td class="col-perkara">Nama Program</td><td class="col-maklumat">${report.namaProgram}</td></tr>
      <tr style="page-break-inside: avoid; break-inside: avoid;"><td class="col-bil">2</td><td class="col-perkara">Tarikh Pelaksanaan</td><td class="col-maklumat">${report.tarikhPelaksanaan}</td></tr>
      <tr style="page-break-inside: avoid; break-inside: avoid;"><td class="col-bil">3</td><td class="col-perkara">Sasaran</td><td class="col-maklumat">${report.sasaran}</td></tr>
      <tr style="page-break-inside: avoid; break-inside: avoid;"><td class="col-bil">4</td><td class="col-perkara">Anjuran</td><td class="col-maklumat">${report.anjuran}</td></tr>
      <tr style="page-break-inside: avoid; break-inside: avoid;"><td class="col-bil">5</td><td class="col-perkara">Objektif</td><td class="col-maklumat"><pre>${report.objektif}</pre></td></tr>
      <tr style="page-break-inside: avoid; break-inside: avoid;"><td class="col-bil">6</td><td class="col-perkara">Kekuatan</td><td class="col-maklumat"><pre>${report.kekuatan}</pre></td></tr>
      <tr style="page-break-inside: avoid; break-inside: avoid;"><td class="col-bil">7</td><td class="col-perkara">Perkara Perlu Penambahbaikan</td><td class="col-maklumat"><pre>${report.perkaraPerluPenambahbaikan}</pre></td></tr>
      <tr style="page-break-inside: avoid; break-inside: avoid;"><td class="col-bil">8</td><td class="col-perkara">Cadangan Penambahbaikan</td><td class="col-maklumat"><pre>${report.cadanganPenambahbaikan}</pre></td></tr>
      ${report.penilaianKeberkesanan ? `
        <tr style="page-break-inside: avoid; break-inside: avoid;"><td class="col-bil">9</td><td class="col-perkara">Penilaian Keberkesanan</td><td class="col-maklumat"><pre>${report.penilaianKeberkesanan}</pre></td></tr>
      ` : ''}
      <tr style="page-break-inside: avoid; break-inside: avoid;">
        <td class="col-bil">${report.penilaianKeberkesanan ? '10' : '9'}</td>
        <td class="col-perkara">Gambar Pelaksanaan</td>
        <td class="col-maklumat" style="line-height: 1.0;">
          <table style="width: 100%; border: none; margin: 0; padding: 0;">
            ${(report.gambarProgram || []).reduce((acc: string[], img: string, i: number) => {
              if (i % 2 === 0) {
                const nextImg = report.gambarProgram[i + 1];
                acc.push(`
                  <tr>
                    <td style="width: 50%; border: none; text-align: center; vertical-align: top; padding: 0;">
                      <img src="${img}" style="max-width: 100%; max-height: 75px; object-fit: contain;" alt="Gambar ${i+1}"/>
                      ${report.peneranganGambar && report.peneranganGambar[i] ? `<p style="font-size: 9pt; font-family: Arial, sans-serif; margin: 0; line-height: 1.0; text-align: center;">${report.peneranganGambar[i]}</p>` : ''}
                    </td>
                    <td style="width: 50%; border: none; text-align: center; vertical-align: top; padding: 0;">
                      ${nextImg ? `
                        <img src="${nextImg}" style="max-width: 100%; max-height: 75px; object-fit: contain;" alt="Gambar ${i+2}"/>
                        ${report.peneranganGambar && report.peneranganGambar[i+1] ? `<p style="font-size: 9pt; font-family: Arial, sans-serif; margin: 0; line-height: 1.0; text-align: center;">${report.peneranganGambar[i+1]}</p>` : ''}
                      ` : ''}
                    </td>
                  </tr>
                `);
              }
              return acc;
            }, []).join('')}
          </table>
        </td>
      </tr>
    </tbody>
  </table>
  <table style="border: none; margin-top: 20px; page-break-inside: avoid; width: 100%;">
    <tr>
      <td style="border: none; width: 50%; padding-right: 20px; vertical-align: top;">
        <p style="margin-bottom: 0.8cm;">Disediakan oleh:</p>
        <div style="border-top: 1px solid black; padding-top: 4px;">
          <p style="margin: 0; font-weight: bold; text-transform: uppercase; line-height: 1.0;">${report.disediakanOleh || ' '}</p>
          <p style="margin: 0; line-height: 1.0;">${report.jawatanDisediakanOleh || ' '}</p>
        </div>
      </td>
      <td style="border: none; width: 50%; padding-left: 20px; vertical-align: top;">
        <p style="margin-bottom: 0.8cm;">Disahkan oleh:</p>
        <div style="border-top: 1px solid black; padding-top: 4px;">
          <p style="margin: 0; font-weight: bold; text-transform: uppercase; line-height: 1.0;">${report.disahkanOleh || ' '}</p>
          <p style="margin: 0; line-height: 1.0;">${report.jawatanDisahkanOleh || ' '}</p>
        </div>
      </td>
    </tr>
  </table>
  <br clear="all" style="page-break-before:always;" />
  ${activeBackCover ? `
    <div style="text-align: center; page-break-before: always; margin-top: 0px; position: relative;">
      <img src="${activeBackCover}" style="max-width: 100%; height: auto;" alt="Muka Belakang" />
      <div style="position: absolute; top: 50%; left: 0; right: 0; width: 100%; display: flex; align-items: center; justify-content: center; transform: translateY(-50%); pointer-events: none; z-index: 20;">
        ${getBackCoverQrHtmlBadge(report.id || reportId, report.namaProgram || report.singkatanProgram || report.namaLaporan || '', qrDataUrl)}
      </div>
    </div>
  ` : `
    <div style="text-align: center; page-break-before: always; padding: 60px 20px; font-family: Arial, sans-serif;">
      <p style="font-size: 10pt; font-weight: bold; text-transform: uppercase; color: #666; margin: 0;">KEMENTERIAN PENDIDIKAN MALAYSIA</p>
      <p style="font-size: 11pt; font-weight: bold; text-transform: uppercase; color: #333; margin: 4px 0 0;">JABATAN PENDIDIKAN NEGERI SARAWAK</p>
      <p style="font-size: 10pt; text-transform: uppercase; color: #666; margin: 2px 0 20px;">PEJABAT PENDIDIKAN DAERAH MIRI</p>
      
      ${activeLogos.length > 0 ? `
        <div style="text-align: center; margin: 30px 0;">
          <img src="${activeLogos[0]}" alt="Logo Sekolah" style="height: 85px; max-height: 85px; width: auto; max-width: 120px; object-fit: contain; display: inline-block;" />
        </div>
      ` : ''}

      <h2 style="font-size: 15pt; font-weight: bold; text-transform: uppercase; margin: 10px 0 0; color: #111827;">SEKOLAH KEBANGSAAN TUDAN</h2>
      <p style="font-size: 11pt; font-weight: bold; text-transform: uppercase; color: #1e3a8a; margin: 4px 0 25px;">MIRI, SARAWAK</p>
      
      <div style="width: 80%; margin: 30px auto; border: 1.5px solid #1e3a8a; border-radius: 6px; padding: 15px 20px; text-align: center; background-color: #f8fafc;">
        <p style="font-size: 9pt; font-weight: bold; text-transform: uppercase; color: #666; margin: 0;">DOKUMEN DOKUMENTASI RASMI</p>
        <h3 style="font-size: 12pt; font-weight: bold; text-transform: uppercase; margin: 6px 0 0; color: #111827;">ONE PAGE REPORT (OPR)</h3>
        <p style="font-size: 10pt; margin: 10px 0 0; font-weight: bold; text-transform: uppercase; color: #1e3a8a;">${report.namaProgram || report.namaLaporan || '-'}</p>
        <p style="font-size: 10pt; margin: 4px 0 0; color: #333;">Tarikh: ${report.tarikhPelaksanaan || '-'}</p>
        <p style="font-size: 10pt; margin: 4px 0 0; color: #333;">Tempat: ${report.tempat || '-'}</p>
      </div>

      <div style="margin-top: 50px;">
        <p style="font-size: 10pt; font-style: italic; color: #555; margin: 0;">"Pendidikan Berkualiti Insan Terdidik Negara Sejahtera"</p>
        <p style="font-size: 8pt; text-transform: uppercase; color: #888; margin-top: 15px;">Dijana Secara Automatik Oleh Sistem Pengurusan OPR Sekolah</p>
      </div>
    </div>
  `}
</body>
</html>
      `;
      await uploadTextToDrive(accessToken, docHtml, report.namaLaporan || `Laporan_${report.namaProgram || 'Program'}`, folderId);

      toast.success('Berjaya dieksport ke Google Drive!', { id: toastId });
    } catch (error: any) {
      console.error("Export to Drive error:", error);
      toast.error(error.message || 'Gagal mengeksport ke Google Drive. Sila log masuk semula.', { id: toastId });
    }
  };

  const renderCoverPage = () => {
    if (activeCover) {
      return (
        <div 
          className="relative w-full max-w-[210mm] mx-auto overflow-hidden cover-page-container shadow-sm border border-gray-100 rounded-lg bg-white print:m-0 print:p-0 print:border-none print:shadow-none print:rounded-none print:w-full print:max-w-none print:h-[297mm] print:max-h-none" 
          style={{ aspectRatio: '1/1.414', pageBreakAfter: 'always', breakAfter: 'page', margin: '0 auto', padding: 0, boxSizing: 'border-box' }}
        >
          <img src={activeCover} alt="Cover Page" className="absolute inset-0 w-full h-full object-cover z-0 print:w-full print:h-full print:object-cover" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
          
          {/* Logo-logo Di Atas Sekali Mengikut Urutan Rasmi (Kemas, Simetri & Seimbang Visual) */}
          {activeLogos.length > 0 && (
            <div 
              className="absolute left-0 right-0 z-20 flex flex-row items-center justify-center flex-nowrap px-6 overflow-visible pointer-events-none" 
              style={{ 
                top: '4.8%', 
                width: '100%',
                height: '76px',
                gap: activeLogos.length > 4 ? '32px' : '36px'
              }}
            >
              {activeLogos.map((l: string, idx: number) => {
                const isKpmLogo = idx === 2 || l.toLowerCase().includes('kpm') || l.toLowerCase().includes('kementerian') || l.toLowerCase().includes('pendidikan');
                const isYayasan = idx === 3 || l.toLowerCase().includes('yayasan') || l.toLowerCase().includes('sarawak');
                const isCurtin = idx === 4 || l.toLowerCase().includes('curtin');

                const userScale = report?.logoScales?.[idx] || 1.0;
                const baseH = activeLogos.length > 4 ? 56 : 60;

                return (
                  <SmartCoverLogo 
                    key={idx} 
                    src={l} 
                    alt={`Logo ${idx + 1}`} 
                    userScale={userScale}
                    baseHeight={baseH}
                    isCurtin={isCurtin}
                    isKpm={isKpmLogo}
                    isYayasan={isYayasan}
                  />
                );
              })}
            </div>
          )}

          {/* Ruangan Maklumat Program Secara Auto Ekstrak Dalam Muka Depan */}
          {/* 1. Tajuk Program - Tepat di tengah ruang putih kotak Tajuk Program dalam 2 baris seimbang */}
          <div 
            className="absolute z-10 flex items-center justify-center px-4 pointer-events-none" 
            style={{ 
              top: '47.6%', 
              left: '34.5%', 
              width: '60.0%', 
              height: '6.4%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box',
              textAlign: 'center'
            }}
          >
            <p 
              className="font-bold text-black border-none bg-transparent m-0 leading-snug text-center uppercase line-clamp-2 w-full tracking-normal" 
              style={{ 
                fontSize: (report.namaProgram || report.namaLaporan || '').length > 40 ? '11pt' : '11.5pt', 
                fontFamily: 'Arial, sans-serif', 
                fontWeight: 'bold', 
                color: '#000000', 
                lineHeight: 1.25,
                textAlign: 'center'
              }}
            >
              {(report.namaProgram || report.singkatanProgram || report.namaLaporan || '').toUpperCase()}
            </p>
          </div>

          {/* 2. Tarikh Pelaksanaan - Tepat di tengah ruang putih kotak Tarikh secara mendatar & menegak */}
          <div 
            className="absolute z-10 flex items-center justify-center px-4 pointer-events-none" 
            style={{ 
              top: '56.8%', 
              left: '34.5%', 
              width: '60.0%', 
              height: '6.4%',
              textAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box'
            }}
          >
            <p 
              className="font-bold text-black border-none bg-transparent m-0 leading-tight text-center w-full uppercase" 
              style={{ fontSize: '12pt', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', color: '#000000', lineHeight: 1.2, textAlign: 'center' }}
            >
              {(report.tarikhPelaksanaan || '-').toUpperCase()}
            </p>
          </div>

          {/* 3. Tempat Pelaksanaan - Tepat di tengah ruang putih kotak Tempat secara mendatar & menegak */}
          <div 
            className="absolute z-10 flex items-center justify-center px-4 pointer-events-none" 
            style={{ 
              top: '66.0%', 
              left: '34.5%', 
              width: '60.0%', 
              height: '6.4%',
              textAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box'
            }}
          >
            <p 
              className="font-bold text-black border-none bg-transparent m-0 leading-tight text-center line-clamp-2 w-full uppercase" 
              style={{ fontSize: '12pt', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', color: '#000000', lineHeight: 1.2, textAlign: 'center' }}
            >
              {(report.tempat || '-').toUpperCase()}
            </p>
          </div>

          {/* 4. Ruang Bawah Sekali Sebelah Kiri: QR Code Diturunkan ke Bawah Sekali Supaya Tidak Bertindih */}
          <div 
            className="absolute z-20 flex items-center justify-start pointer-events-auto" 
            style={{ 
              bottom: '0.4%', 
              left: '1.5%', 
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start'
            }}
          >
            <CoverQrBadge 
              reportId={report?.id || reportId}
              namaProgram={report?.namaProgram || report?.singkatanProgram || report?.namaLaporan}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="relative w-full max-w-[210mm] mx-auto overflow-hidden cover-page-container flex flex-col items-center justify-between pt-[1.2cm] pb-[1.2cm] px-[1.5cm] bg-white mb-6 shadow-sm border border-gray-100 rounded-lg" style={{ aspectRatio: '1/1.414', pageBreakAfter: 'always', breakAfter: 'page', maxHeight: '277mm' }}>
        {/* LOGO IKUT URUTAN SISTEM DI ATAS SEKALI (SEMUA SAMA SAIZ & LURUS SEBARIS) */}
        {activeLogos.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: activeLogos.length > 4 ? '32px' : '36px', marginBottom: '0.45cm', width: '100%', flexWrap: 'nowrap', overflow: 'hidden' }}>
            {activeLogos.map((l: string, idx: number) => {
              const isKpmLogo = idx === 2 || l.toLowerCase().includes('kpm') || l.toLowerCase().includes('kementerian') || l.toLowerCase().includes('pendidikan');
              const isYayasan = idx === 3 || l.toLowerCase().includes('yayasan') || l.toLowerCase().includes('sarawak');
              const isCurtin = idx === 4 || l.toLowerCase().includes('curtin');
              const userScale = report?.logoScales?.[idx] || 1.0;

              let h = 54;
              let maxW = 75;
              if (isCurtin) {
                h = 32;
                maxW = 120;
              } else if (isKpmLogo) {
                h = 56;
                maxW = 78;
              } else if (isYayasan) {
                h = 50;
                maxW = 78;
              }

              const finalH = Math.round(h * userScale);
              const finalMaxW = Math.round(maxW * userScale);

              return (
                <div 
                  key={idx} 
                  style={{ 
                    display: 'inline-flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    flexShrink: 0
                  }}
                >
                  <img 
                    src={l} 
                    alt={`Logo ${idx + 1}`} 
                    style={{ 
                      height: `${finalH}px`, 
                      maxHeight: `${finalH}px`, 
                      width: 'auto', 
                      maxWidth: `${finalMaxW}px`, 
                      objectFit: 'contain',
                      imageRendering: '-webkit-optimize-contrast',
                      display: 'block'
                    }} 
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* TAJUK RASMI DOKUMEN & NAMA PROGRAM */}
        <div style={{ textAlign: 'center', marginBottom: '0.5cm', fontFamily: '"Arial", sans-serif', width: '100%' }}>
          <h1 style={{ fontSize: '15pt', fontWeight: 'bold', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em', color: '#111827' }}>
            ONE PAGE REPORT (OPR)
          </h1>
          <p style={{ fontSize: '11pt', fontWeight: 'bold', textTransform: 'uppercase', margin: '4px 0 0', color: '#1e3a8a' }}>
            SEKOLAH KEBANGSAAN TUDAN, MIRI
          </p>
          <div style={{ height: '3px', width: '70px', backgroundColor: '#2563eb', margin: '8px auto 12px' }}></div>
          <h2 style={{ fontSize: '13pt', fontWeight: 'bold', textTransform: 'uppercase', margin: 0, lineHeight: 1.3, color: '#111827', padding: '0 16px' }}>
            {report.namaProgram || report.namaLaporan || ''}
          </h2>
          {report.singkatanProgram && report.singkatanProgram !== report.namaProgram && (
            <p style={{ fontSize: '11pt', fontWeight: '600', color: '#4b5563', marginTop: '4px', textTransform: 'uppercase' }}>
              ({report.singkatanProgram})
            </p>
          )}
        </div>
        
        {/* GAMBAR PROGRAM (JIKA ADA) */}
        <div style={{ width: '100%', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '160px' }}>
          {report.gambarProgram && report.gambarProgram.length > 0 ? (
            <img 
              src={report.gambarProgram[0]} 
              alt="Gambar Program" 
              style={{ 
                width: '75%', 
                maxHeight: '320px', 
                objectFit: 'cover', 
                borderRadius: '8px', 
                boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                border: '1px solid #e5e7eb'
              }} 
            />
          ) : (
            <div style={{ width: '75%', height: '160px', border: '2px dashed #d1d5db', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '11pt' }}>
              SEKOLAH KEBANGSAAN TUDAN, MIRI
            </div>
          )}
        </div>

        {/* RUANGAN MAKLUMAT PROGRAM SECARA AUTO */}
        <div style={{ width: '88%', marginTop: '0.5cm', border: '1.5px solid #000000', borderRadius: '8px', backgroundColor: '#f8fafc', padding: '14px 20px', fontFamily: '"Arial", sans-serif' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11pt', lineHeight: 1.5, color: '#000000' }}>
            <tbody>
              <tr>
                <td style={{ width: '32%', fontWeight: 'bold', color: '#000000', verticalAlign: 'top', padding: '3px 0' }}>Nama Program</td>
                <td style={{ width: '4%', fontWeight: 'bold', color: '#000000', verticalAlign: 'top', padding: '3px 0' }}>:</td>
                <td style={{ width: '64%', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', verticalAlign: 'top', padding: '3px 0' }}>{report.namaProgram || report.namaLaporan || '-'}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 'bold', color: '#000000', verticalAlign: 'top', padding: '3px 0' }}>Tarikh Pelaksanaan</td>
                <td style={{ fontWeight: 'bold', color: '#000000', verticalAlign: 'top', padding: '3px 0' }}>:</td>
                <td style={{ color: '#000000', verticalAlign: 'top', padding: '3px 0' }}>{report.tarikhPelaksanaan || '-'}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 'bold', color: '#000000', verticalAlign: 'top', padding: '3px 0' }}>Tempat Pelaksanaan</td>
                <td style={{ fontWeight: 'bold', color: '#000000', verticalAlign: 'top', padding: '3px 0' }}>:</td>
                <td style={{ color: '#000000', verticalAlign: 'top', padding: '3px 0' }}>{report.tempat || '-'}</td>
              </tr>
              {report.anjuran && (
                <tr>
                  <td style={{ fontWeight: 'bold', color: '#000000', verticalAlign: 'top', padding: '3px 0' }}>Anjuran</td>
                  <td style={{ fontWeight: 'bold', color: '#000000', verticalAlign: 'top', padding: '3px 0' }}>:</td>
                  <td style={{ color: '#000000', verticalAlign: 'top', padding: '3px 0' }}>{report.anjuran}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Ruangan Bawah Sekali: QR Code & Pautan Digital OPR Auto Dijana */}
        <div style={{ marginTop: '0.45cm', display: 'flex', justifyContent: 'center', width: '100%' }}>
          <CoverQrBadge 
            reportId={report?.id || reportId}
            namaProgram={report?.namaProgram || report?.singkatanProgram || report?.namaLaporan}
          />
        </div>
      </div>
    );
  };

  const renderBackCoverPage = () => {
    if (activeBackCover) {
      return (
        <div 
          className="relative w-full max-w-[210mm] mx-auto overflow-hidden back-cover-page-container mt-6 shadow-sm border border-gray-100 rounded-lg bg-white print:m-0 print:p-0 print:border-none print:shadow-none print:rounded-none print:w-full print:max-w-none print:h-[297mm] print:max-h-none" 
          style={{ 
            aspectRatio: '1/1.414', 
            pageBreakBefore: 'always', 
            breakBefore: 'page' 
          }}
        >
          <img 
            src={activeBackCover} 
            alt="Cover Belakang" 
            className="w-full h-full object-cover print:w-full print:h-full print:object-cover" 
            style={{ 
              position: 'absolute', 
              top: 0, 
              left: 0, 
              width: '100%', 
              height: '100%', 
              objectFit: 'cover',
              display: 'block' 
            }} 
          />

          {/* QR Code di tengah cover belakang */}
          <div 
            className="absolute z-20 flex items-center justify-center pointer-events-auto" 
            style={{ 
              top: '50%', 
              left: '50%', 
              transform: 'translate(-50%, -50%)', 
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <CoverQrBadge 
              reportId={report?.id || reportId}
              namaProgram={report?.namaProgram || report?.singkatanProgram || report?.namaLaporan}
              isBackCover={true}
            />
          </div>
        </div>
      );
    }

    const primarySchoolLogo = activeLogos.length > 0 ? activeLogos[0] : null;

    return (
      <div 
        className="relative w-full max-w-[210mm] mx-auto overflow-hidden back-cover-page-container mt-6 shadow-sm border border-gray-100 rounded-lg bg-white flex flex-col items-center justify-between p-8 sm:p-12 text-center print:m-0 print:border-none print:shadow-none print:rounded-none" 
        style={{ 
          aspectRatio: '1/1.414', 
          pageBreakBefore: 'always', 
          breakBefore: 'page', 
          minHeight: '290mm', 
          maxHeight: '297mm', 
          fontFamily: '"Arial", sans-serif',
          background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 50%, #eff6ff 100%)'
        }}
      >
        {/* Atas: Identiti Kementerian & Jabatan */}
        <div className="w-full pt-4">
          <p className="text-xs uppercase tracking-widest text-gray-500 font-bold mb-1">KEMENTERIAN PENDIDIKAN MALAYSIA</p>
          <p className="text-sm uppercase tracking-wider text-gray-800 font-bold">JABATAN PENDIDIKAN NEGERI SARAWAK</p>
          <p className="text-xs uppercase tracking-wider text-gray-600">PEJABAT PENDIDIKAN DAERAH MIRI</p>
        </div>

        {/* Tengah: Lencana Sekolah & Maklumat OPR & QR Code */}
        <div className="flex flex-col items-center justify-center my-auto py-4 w-full">
          {primarySchoolLogo ? (
            <img 
              src={primarySchoolLogo} 
              alt="Logo Sekolah" 
              style={{ 
                height: '80px', 
                maxHeight: '80px', 
                width: 'auto', 
                maxWidth: '115px', 
                objectFit: 'contain',
                marginBottom: '12px'
              }} 
            />
          ) : (
            <div className="w-16 h-16 rounded-full border-2 border-blue-600 flex items-center justify-center mb-3 bg-blue-50 text-blue-700 font-bold text-lg">
              SKT
            </div>
          )}

          <h2 className="text-lg font-bold uppercase tracking-wider text-gray-900 mb-1">
            SEKOLAH KEBANGSAAN TUDAN
          </h2>
          <p className="text-xs font-semibold text-blue-800 tracking-wide uppercase">
            MIRI, SARAWAK
          </p>

          <div className="w-16 h-0.5 bg-blue-600 my-4 mx-auto rounded-full"></div>

          {/* QR Code di tengah cover belakang */}
          <div className="w-full flex justify-center my-2">
            <CoverQrBadge 
              reportId={report?.id || reportId}
              namaProgram={report?.namaProgram || report?.singkatanProgram || report?.namaLaporan}
              isBackCover={true}
            />
          </div>
        </div>

        {/* Bawah: Slogan Rasmi */}
        <div className="w-full pb-4 border-t border-gray-200 pt-3">
          <p className="text-xs font-bold text-blue-900 tracking-wider uppercase mb-1">
            "BERILMU • BERAKHLAK • BERJAYA"
          </p>
          <p className="text-[11px] text-gray-500 italic">
            Shine Tudan Shine
          </p>
        </div>
      </div>
    );
  };

  const renderOprPage = () => (
    <div 
      className="px-4 pb-4 sm:px-6 sm:pb-6 print:px-8 print:pb-6 print:m-0 opr-page-container relative overflow-hidden bg-white max-w-[210mm] mx-auto border border-gray-100 rounded-lg shadow-xs print:border-none print:shadow-none text-black" 
      style={{ fontSize: '11pt', lineHeight: 1.5, paddingTop: '1in', color: '#000000' }}
    >
      <div className="relative print:mt-0 text-black" style={{ color: '#000000' }}>
        
        {/* Tajuk Rasmi OPR - Dinaikkan ke atas sepenuhnya */}
        <div className="text-center mt-0 mb-2 border-b border-gray-200 pb-1.5 print:mb-1.5 print:pb-1 text-black">
          <h2 className="text-base sm:text-lg font-bold uppercase tracking-wider text-black m-0" style={{ letterSpacing: '0.05em', lineHeight: 1.1, color: '#000000' }}>
            ONE PAGE REPORT (OPR)
          </h2>
          <p className="text-xs sm:text-sm font-semibold uppercase text-black m-0" style={{ lineHeight: 1.2, color: '#000000' }}>
            SEKOLAH KEBANGSAAN TUDAN, MIRI
          </p>
        </div>

        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full border-collapse border border-black mb-2 print:min-w-full text-black" style={{ fontSize: '11pt', lineHeight: 1.15, fontFamily: 'Arial, sans-serif', color: '#000000' }}>
            <thead>
              <tr className="bg-gray-100 text-black" style={{ color: '#000000' }}>
                <th className="border border-black p-0.5 bg-gray-100 font-bold text-center text-black" style={{ width: '5%', color: '#000000' }}>BIL</th>
                <th className="border border-black p-0.5 bg-gray-100 font-bold text-center text-black" style={{ width: '20%', color: '#000000' }}>PERKARA</th>
                <th className="border border-black p-0.5 bg-gray-100 font-bold text-center text-black" style={{ width: '75%', color: '#000000' }}>MAKLUMAT</th>
              </tr>
            </thead>
            <tbody className="text-black" style={{ color: '#000000' }}>
              <tr style={{ pageBreakInside: 'avoid', breakInside: 'avoid', color: '#000000' }}>
                <td className="border border-black p-0.5 text-center font-bold text-black" style={{ color: '#000000' }}>1</td>
                <td className="border border-black p-0.5 font-bold text-black" style={{ color: '#000000' }}>Nama Program</td>
                <td className="border border-black p-0.5 text-justify font-semibold text-black" style={{ color: '#000000' }}>{report.namaProgram || report.namaLaporan || '-'}</td>
              </tr>
              <tr style={{ pageBreakInside: 'avoid', breakInside: 'avoid', color: '#000000' }}>
                <td className="border border-black p-0.5 text-center font-bold text-black" style={{ color: '#000000' }}>2</td>
                <td className="border border-black p-0.5 font-bold text-black" style={{ color: '#000000' }}>Tarikh Pelaksanaan</td>
                <td className="border border-black p-0.5 text-justify text-black" style={{ color: '#000000' }}>{report.tarikhPelaksanaan || '-'}</td>
              </tr>
              <tr style={{ pageBreakInside: 'avoid', breakInside: 'avoid', color: '#000000' }}>
                <td className="border border-black p-0.5 text-center font-bold text-black" style={{ color: '#000000' }}>3</td>
                <td className="border border-black p-0.5 font-bold text-black" style={{ color: '#000000' }}>Tempat</td>
                <td className="border border-black p-0.5 text-justify text-black" style={{ color: '#000000' }}>{report.tempat || '-'}</td>
              </tr>
              <tr style={{ pageBreakInside: 'avoid', breakInside: 'avoid', color: '#000000' }}>
                <td className="border border-black p-0.5 text-center font-bold text-black" style={{ color: '#000000' }}>4</td>
                <td className="border border-black p-0.5 font-bold text-black" style={{ color: '#000000' }}>Sasaran</td>
                <td className="border border-black p-0.5 text-justify text-black" style={{ color: '#000000' }}>{report.sasaran || '-'}</td>
              </tr>
              <tr style={{ pageBreakInside: 'avoid', breakInside: 'avoid', color: '#000000' }}>
                <td className="border border-black p-0.5 text-center font-bold text-black" style={{ color: '#000000' }}>5</td>
                <td className="border border-black p-0.5 font-bold text-black" style={{ color: '#000000' }}>Anjuran</td>
                <td className="border border-black p-0.5 text-justify text-black" style={{ color: '#000000' }}>{report.anjuran || '-'}</td>
              </tr>
              <tr style={{ pageBreakInside: 'avoid', breakInside: 'avoid', color: '#000000' }}>
                <td className="border border-black p-0.5 text-center font-bold text-black" style={{ color: '#000000' }}>6</td>
                <td className="border border-black p-0.5 font-bold text-black" style={{ color: '#000000' }}>Objektif</td>
                <td className="border border-black p-0.5 whitespace-pre-wrap text-justify text-black" style={{ color: '#000000' }}>{report.objektif || '-'}</td>
              </tr>
              <tr style={{ pageBreakInside: 'avoid', breakInside: 'avoid', color: '#000000' }}>
                <td className="border border-black p-0.5 text-center font-bold text-black" style={{ color: '#000000' }}>7</td>
                <td className="border border-black p-0.5 font-bold text-black" style={{ color: '#000000' }}>Kekuatan</td>
                <td className="border border-black p-0.5 whitespace-pre-wrap text-justify text-black" style={{ color: '#000000' }}>{report.kekuatan || '-'}</td>
              </tr>
              <tr style={{ pageBreakInside: 'avoid', breakInside: 'avoid', color: '#000000' }}>
                <td className="border border-black p-0.5 text-center font-bold text-black" style={{ color: '#000000' }}>8</td>
                <td className="border border-black p-0.5 font-bold text-black" style={{ color: '#000000' }}>Perkara Perlu Penambahbaikan</td>
                <td className="border border-black p-0.5 whitespace-pre-wrap text-justify text-black" style={{ color: '#000000' }}>{report.perkaraPerluPenambahbaikan || '-'}</td>
              </tr>
              <tr style={{ pageBreakInside: 'avoid', breakInside: 'avoid', color: '#000000' }}>
                <td className="border border-black p-0.5 text-center font-bold text-black" style={{ color: '#000000' }}>9</td>
                <td className="border border-black p-0.5 font-bold text-black" style={{ color: '#000000' }}>Cadangan Penambahbaikan</td>
                <td className="border border-black p-0.5 whitespace-pre-wrap text-justify text-black" style={{ color: '#000000' }}>{report.cadanganPenambahbaikan || '-'}</td>
              </tr>
              {report.penilaianKeberkesanan && (
                <tr style={{ pageBreakInside: 'avoid', breakInside: 'avoid', color: '#000000' }}>
                  <td className="border border-black p-0.5 text-center font-bold text-black" style={{ color: '#000000' }}>10</td>
                  <td className="border border-black p-0.5 font-bold text-black" style={{ color: '#000000' }}>Penilaian Keberkesanan</td>
                  <td className="border border-black p-0.5 whitespace-pre-wrap text-justify text-black" style={{ color: '#000000' }}>{report.penilaianKeberkesanan}</td>
                </tr>
              )}
              <tr style={{ pageBreakInside: 'avoid', breakInside: 'avoid', color: '#000000' }}>
                <td className="border border-black p-0.5 text-center font-bold text-black" style={{ color: '#000000' }}>{report.penilaianKeberkesanan ? '11' : '10'}</td>
                <td className="border border-black p-0.5 font-bold decoration-clone text-black" style={{ color: '#000000' }}>Gambar Pelaksanaan</td>
                <td className="border border-black p-0.5 text-black" style={{ lineHeight: 1.0, color: '#000000' }}>
                  {report.gambarProgram && report.gambarProgram.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2 print:break-inside-avoid mb-2">
                      {report.gambarProgram.map((url: string, index: number) => (
                        <div key={index} className="flex flex-col">
                          <div 
                            className="h-[75px] w-full border border-dashed border-gray-400 overflow-hidden flex items-center justify-center relative group cursor-pointer"
                            onClick={() => !showPreview && setSelectedImageIndex(index)}
                          >
                            <img src={url} alt={`Gambar ${index + 1}`} className="max-w-full max-h-full object-contain" referrerPolicy="no-referrer" />
                            {!showPreview && (
                              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all flex items-center justify-center print:hidden">
                                <span className="text-white opacity-0 group-hover:opacity-100 drop-shadow-md font-medium text-sm bg-black/50 px-3 py-1 rounded-full">Besarkan</span>
                              </div>
                            )}
                          </div>
                          {report.peneranganGambar && report.peneranganGambar[index] && (
                            <p className="text-[9pt] text-center italic mt-0.5 text-black" style={{ lineHeight: 1.0, color: '#000000' }}>{report.peneranganGambar[index]}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-black italic" style={{ color: '#000000' }}>Tiada gambar dimuat naik.</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex justify-between mt-4 px-8 print:px-4 text-black" style={{ fontSize: '11pt', lineHeight: 1.0, pageBreakInside: 'avoid', color: '#000000' }}>
          <div className="text-left w-2/5 text-black" style={{ color: '#000000' }}>
            <p style={{ marginBottom: '0.8cm', color: '#000000' }}>Disediakan oleh:</p>
            <div style={{ borderTop: '1px solid black', width: '100%', paddingTop: '4px' }}>
              <p className="font-bold uppercase whitespace-nowrap m-0 text-black" style={{ color: '#000000' }}>{report.disediakanOleh || ' '}</p>
              <p className="m-0 text-black" style={{ color: '#000000' }}>{report.jawatanDisediakanOleh || ' '}</p>
            </div>
          </div>
          <div className="text-left w-2/5 text-black" style={{ color: '#000000' }}>
            <p style={{ marginBottom: '0.8cm', color: '#000000' }}>Disahkan oleh:</p>
            <div style={{ borderTop: '1px solid black', width: '100%', paddingTop: '4px' }}>
              <p className="font-bold uppercase whitespace-nowrap m-0 text-black" style={{ color: '#000000' }}>{report.disahkanOleh || ' '}</p>
              <p className="m-0 text-black" style={{ color: '#000000' }}>{report.jawatanDisahkanOleh || ' '}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderReportContent = () => (
    <div className="bg-white print:bg-white" ref={reportRef} style={{ fontFamily: 'Arial, Helvetica, sans-serif', color: '#000' }}>
      {(activeTab === 'cover' || activeTab === 'all') && renderCoverPage()}
      
      {(activeTab === 'opr' || activeTab === 'all') && (
        <div ref={oprRef} className="w-full">
          {renderOprPage()}
        </div>
      )}

      {(activeTab === 'back' || activeTab === 'all') && renderBackCoverPage()}
    </div>
  );

  return (
    <>
      <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden print:overflow-visible print:border-none print:shadow-none ${showPreview ? 'hidden print:block' : ''}`}>
        <div className="border-b border-gray-100 p-4 sm:p-6 flex items-center justify-between bg-gray-50/50 print:hidden flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <button 
              onClick={onBack}
              className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                  <FileText size={18} />
                </span>
                <h2 className="text-xl font-bold text-gray-900">Paparan OPR (One Page Report)</h2>
              </div>
              <p className="text-xs text-gray-500 mt-0.5 truncate max-w-md">
                {report.namaProgram || report.namaLaporan || 'One Page Report'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Dedicated Print to PDF Button */}
            <button 
              onClick={handlePrintToPdf}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-lg transition-all font-bold text-sm shadow-xs hover:shadow active:scale-95"
              title="Print to PDF - Cetak Dokumen A4 Rasmi"
            >
              <Printer size={18} className="stroke-[2.5]" />
              <span>Print to PDF</span>
            </button>

            {/* Direct OPR PDF Mode Button */}
            <button 
              onClick={() => {
                if (onViewPdf) {
                  onViewPdf();
                } else {
                  const url = getReportDigitalUrl(report.id || reportId, report.namaProgram);
                  window.open(url, '_blank');
                }
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-red-50 text-red-700 hover:bg-red-100 rounded-lg transition-colors font-bold text-sm border border-red-200"
              title="Buka Dokumen OPR dalam Format PDF Rasmi (Format Paparan QR Code)"
            >
              <FileText size={18} className="text-red-600" />
              <span>Paparan PDF</span>
              <span className="bg-red-600 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded">PDF</span>
            </button>

            <button 
              onClick={() => setShowPreview(true)}
              className="flex items-center gap-2 px-3.5 py-2 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg transition-colors font-medium text-sm"
              title="Pratonton Penuh OPR"
            >
              <Eye size={18} />
              <span className="hidden sm:inline">Pratonton OPR</span>
            </button>
            <button 
              onClick={handleDownloadPdfClick}
              disabled={isGeneratingPdf}
              className="flex items-center gap-2 px-3.5 py-2 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg transition-colors font-medium text-sm disabled:opacity-50"
            >
              <Download size={18} />
              <span className="hidden sm:inline">{isGeneratingPdf ? 'Menjana...' : 'Muat Turun PDF'}</span>
            </button>
            <button 
              onClick={handleDownloadWord}
              className="flex items-center gap-2 px-3.5 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg transition-colors font-medium text-sm"
            >
              <FileText size={18} />
              <span className="hidden sm:inline">Muat Turun Word</span>
            </button>
            <button 
              onClick={handleExportDrive}
              className="flex items-center gap-2 px-3.5 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg transition-colors font-medium text-sm"
              title="Eksport ke Google Drive"
            >
              <Cloud size={18} />
              <span className="hidden sm:inline">Eksport Drive</span>
            </button>
            <button 
              onClick={handlePrint}
              className="flex items-center gap-2 px-3.5 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors font-medium text-sm"
            >
              <Printer size={18} />
              <span className="hidden sm:inline">Cetak</span>
            </button>
            <button 
              onClick={onEdit}
              className="flex items-center gap-2 px-3.5 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors font-medium text-sm"
            >
              <Edit2 size={18} />
              <span className="hidden sm:inline">Edit</span>
            </button>
          </div>
        </div>

        {/* Tab Navigasi Paparan OPR */}
        <div className="flex items-center gap-2 px-4 sm:px-6 py-3 border-b border-gray-100 bg-gray-50/80 print:hidden overflow-x-auto">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider mr-1 hidden sm:inline">Pilihan Paparan:</span>

          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'all'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            <Layers size={15} />
            <span>Laporan Lengkap (Muka Depan + OPR + Muka Belakang)</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${activeTab === 'all' ? 'bg-blue-700 text-white' : 'bg-green-100 text-green-700'}`}>3 Muka</span>
          </button>
          
          <button
            type="button"
            onClick={() => setActiveTab('opr')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'opr'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            <FileText size={15} />
            <span>Jadual OPR Sahaja</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${activeTab === 'opr' ? 'bg-blue-700 text-white' : 'bg-blue-100 text-blue-700'}`}>1 Muka</span>
          </button>
          
          <button
            type="button"
            onClick={() => setActiveTab('cover')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'cover'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            <ImageIcon size={15} />
            <span>Muka Depan (Cover)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('back')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'back'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            <ImageIcon size={15} />
            <span>Muka Belakang</span>
          </button>
        </div>

        <div className="p-4 sm:p-6 bg-gray-50/30">
          {!showPreview && renderReportContent()}
        </div>
      </div>

      {/* Print Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 z-50 bg-gray-900/80 backdrop-blur-sm overflow-y-auto p-4 sm:p-8 flex justify-center print:hidden">
          <div className="relative w-full max-w-[1000px] bg-white shadow-2xl rounded-sm my-auto flex flex-col max-h-full">
            <div className="sticky top-0 z-10 bg-gray-100 border-b border-gray-200 p-4 flex justify-between items-center rounded-t-sm shadow-sm">
              <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm sm:text-base">
                <FileText size={20} className="text-red-600" />
                <span>Dokumen OPR (Format PDF)</span>
                <span className="bg-red-100 text-red-700 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider hidden sm:inline">
                  A4 PDF
                </span>
              </h3>
              <div className="flex gap-2 items-center">
                <button 
                  onClick={handlePrintToPdf}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-lg transition-all font-bold text-sm shadow-xs"
                  title="Print to PDF - Cetak Dokumen A4 Rasmi"
                >
                  <Printer size={18} className="stroke-[2.5]" />
                  <span>Print to PDF</span>
                </button>
                <button 
                  onClick={handleDownloadPdfClick}
                  disabled={isGeneratingPdf}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white hover:bg-green-700 rounded-lg transition-colors font-medium disabled:opacity-50"
                >
                  <Download size={18} />
                  <span className="hidden sm:inline">{isGeneratingPdf ? 'Menjana...' : 'Muat Turun PDF'}</span>
                </button>
                <button 
                  onClick={handleDownloadWord}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg transition-colors font-medium"
                >
                  <FileText size={18} />
                  <span className="hidden sm:inline">Muat Turun Word</span>
                </button>
                <button 
                  onClick={handleExportDrive}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg transition-colors font-medium"
                  title="Eksport ke Google Drive"
                >
                  <Cloud size={18} />
                  <span className="hidden sm:inline">Eksport Drive</span>
                </button>
                <button 
                  onClick={handlePrint}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors font-medium"
                >
                  <Printer size={18} />
                  <span className="hidden sm:inline">Print</span>
                </button>
                <button 
                  onClick={() => setShowPreview(false)}
                  className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded-full transition-colors ml-2"
                >
                  <X size={24} />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto bg-gray-200 p-4 sm:p-8 flex justify-center">
              <div className="bg-white shadow-lg w-full max-w-[210mm] min-h-[297mm]">
                {renderReportContent()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print Settings Modal */}
      {showPrintSettings && (
        <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Printer size={20} className="text-blue-600" />
                Tetapan Cetakan
              </h3>
              <button onClick={() => setShowPrintSettings(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Skop Cetakan / PDF</label>
                <select 
                  value={printScope} 
                  onChange={(e) => setPrintScope(e.target.value as 'opr' | 'all')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none font-medium"
                >
                  <option value="all">📚 Semua Halaman (Muka Depan + OPR + Muka Belakang) - Lengkap</option>
                  <option value="opr">📄 Paparan OPR Sahaja (1 Muka Surat)</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">Dokumen lengkap menjana set laporan penuh rasmi (Muka Depan + OPR + Muka Belakang).</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Saiz Kertas</label>
                <select 
                  value={printSize} 
                  onChange={(e) => setPrintSize(e.target.value as 'a4' | 'letter')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="a4">A4</option>
                  <option value="letter">Letter</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Orientasi</label>
                <select 
                  value={printOrientation} 
                  onChange={(e) => setPrintOrientation(e.target.value as 'p' | 'l')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="p">Potret (Portrait)</option>
                  <option value="l">Landskap (Landscape)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Jidar (Margin)</label>
                <select 
                  value={printMargin} 
                  onChange={(e) => setPrintMargin(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="0mm">Tiada Jidar (0 inc)</option>
                  <option value="2.54mm">Sangat Sempit (0.1 inc)</option>
                  <option value="5.08mm">Sangat Sempit (0.2 inc)</option>
                  <option value="12mm">Tepat (12 mm)</option>
                  <option value="12.7mm">Sempit (0.5 inc)</option>
                  <option value="25.4mm">Normal (1.0 inc)</option>
                  <option value="38.1mm">Lebar (1.5 inc)</option>
                </select>
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-2">
              <button 
                onClick={() => setShowPrintSettings(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg font-medium transition-colors"
              >
                Batal
              </button>
              <button 
                onClick={printAction === 'pdf' ? executeDownloadPdf : executePrint}
                className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                {printAction === 'pdf' ? <Download size={18} /> : <Printer size={18} />}
                {printAction === 'pdf' ? 'Jana PDF' : 'Cetak'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Modal Carousel */}
      {selectedImageIndex !== null && report?.gambarProgram && !showPreview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 print:hidden backdrop-blur-sm">
          <button 
            onClick={() => setSelectedImageIndex(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white p-2 transition-colors z-50"
          >
            <X size={32} />
          </button>
          
          {report.gambarProgram.length > 1 && (
            <button 
              onClick={handlePrevImage}
              className="absolute left-4 sm:left-8 text-white/70 hover:text-white p-3 bg-black/50 hover:bg-black/80 rounded-full transition-all z-50"
            >
              <ChevronLeft size={32} />
            </button>
          )}

          <div className="relative max-w-[90vw] max-h-[85vh] flex items-center justify-center">
            <img 
              src={report.gambarProgram[selectedImageIndex]} 
              alt={`Gambar ${selectedImageIndex + 1}`} 
              className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl"
              referrerPolicy="no-referrer"
            />
          </div>

          {report.gambarProgram.length > 1 && (
            <button 
              onClick={handleNextImage}
              className="absolute right-4 sm:right-8 text-white/70 hover:text-white p-3 bg-black/50 hover:bg-black/80 rounded-full transition-all z-50"
            >
              <ChevronRight size={32} />
            </button>
          )}
          
          <div className="absolute bottom-6 left-0 right-0 text-center text-white/90 font-medium tracking-widest text-sm">
            {selectedImageIndex + 1} / {report.gambarProgram.length}
          </div>
        </div>
      )}
    </>
  );
}
