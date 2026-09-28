import React, { useState, useEffect, useRef } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { getReportWithMedia } from '../services/reportStorageService';
import { 
  ArrowLeft, 
  Printer, 
  Download, 
  Share2, 
  Check, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  Maximize2, 
  FileText, 
  ExternalLink,
  Layers,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import toast from 'react-hot-toast';
import CoverQrBadge from './CoverQrBadge';

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

interface SmartCoverLogoProps {
  key?: React.Key;
  src: string; 
  alt: string; 
  userScale?: number; 
  baseHeight?: number; 
  isCurtin?: boolean;
  isKpm?: boolean;
  isYayasan?: boolean;
}

function SmartCoverLogo({ 
  src, 
  alt, 
  userScale = 1.0, 
  baseHeight = 56, 
  isCurtin = false,
  isKpm = false,
  isYayasan = false
}: SmartCoverLogoProps) {
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

  let optHeight = baseHeight;
  let optMaxW = 75;

  if (isCurtin || aspectRatio > 2.2) {
    optHeight = Math.round(baseHeight * 0.57);
    optMaxW = 125;
  } else if (isKpm) {
    optHeight = Math.round(baseHeight * 1.04);
    optMaxW = 80;
  } else if (isYayasan || aspectRatio > 1.25) {
    optHeight = Math.round(baseHeight * 0.93);
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

interface OprPdfViewerProps {
  reportId: string;
  onBackToDashboard?: () => void;
}

export default function OprPdfViewer({ reportId, onBackToDashboard }: OprPdfViewerProps) {
  const [report, setReport] = useState<any>(null);
  const [coverTemplate, setCoverTemplate] = useState<string>('');
  const [backCoverTemplate, setBackCoverTemplate] = useState<string>('');
  const [systemLogos, setSystemLogos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [activePageTab, setActivePageTab] = useState<'all' | 'cover' | 'opr' | 'back'>('all');
  const [scale, setScale] = useState<number>(1);
  const [copiedLink, setCopiedLink] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const coverPageRef = useRef<HTMLDivElement>(null);
  const oprPageRef = useRef<HTMLDivElement>(null);
  const backCoverPageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchReportAndSettings = async () => {
      try {
        try {
          const settingsRef = doc(db, 'settings', 'global');
          const settingsSnap = await getDoc(settingsRef);
          if (settingsSnap.exists()) {
            const data = settingsSnap.data();
            setCoverTemplate(data.coverTemplate || '');
            setBackCoverTemplate(data.backCoverTemplate || '');
            if (Array.isArray(data.logos)) {
              setSystemLogos(data.logos);
            }
          }
        } catch (err) {
          console.warn('Settings fetch warning:', err);
        }

        const fullReport = await getReportWithMedia(reportId);
        if (fullReport) {
          setReport(fullReport);
        }
      } catch (error) {
        console.error('Error fetching report:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchReportAndSettings();
  }, [reportId]);

  // Responsive scale fit on mobile
  useEffect(() => {
    const handleResize = () => {
      if (typeof window !== 'undefined') {
        const screenWidth = window.innerWidth;
        // A4 page width is 210mm (~794px at 96 DPI)
        if (screenWidth < 840) {
          const targetW = screenWidth - 32;
          const calculatedScale = Math.min(1, Math.max(0.42, targetW / 794));
          setScale(Number(calculatedScale.toFixed(2)));
        } else {
          setScale(1);
        }
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
    toast('Membuka dialog cetakan PDF (A4)... Sila pilih "Save as PDF".', {
      icon: '🖨️',
      duration: 3500,
    });
    setTimeout(() => {
      window.print();
    }, 200);
  };

  const handleDownloadPdfFile = async () => {
    if (!containerRef.current || isGeneratingPdf) return;
    setIsGeneratingPdf(true);
    const toastId = toast.loading('Menjana fail PDF OPR berkualiti tinggi...', { duration: 15000 });

    try {
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true,
      });

      const pagesToCapture: HTMLElement[] = [];
      if (activePageTab === 'all') {
        if (coverPageRef.current) pagesToCapture.push(coverPageRef.current);
        if (oprPageRef.current) pagesToCapture.push(oprPageRef.current);
        if (backCoverPageRef.current) pagesToCapture.push(backCoverPageRef.current);
      } else if (activePageTab === 'cover' && coverPageRef.current) {
        pagesToCapture.push(coverPageRef.current);
      } else if (activePageTab === 'opr' && oprPageRef.current) {
        pagesToCapture.push(oprPageRef.current);
      } else if (activePageTab === 'back' && backCoverPageRef.current) {
        pagesToCapture.push(backCoverPageRef.current);
      }

      if (pagesToCapture.length === 0) {
        throw new Error('Tiada halaman untuk dijana');
      }

      for (let i = 0; i < pagesToCapture.length; i++) {
        const pageEl = pagesToCapture[i];
        const canvas = await html2canvas(pageEl, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false,
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        if (i > 0) {
          pdf.addPage('a4', 'portrait');
        }
        pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      }

      const programName = report?.namaProgram || report?.namaLaporan || 'OPR';
      const cleanFileName = `Laporan_OPR_${programName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 45)}.pdf`;
      pdf.save(cleanFileName);
      toast.success('Fail PDF berjaya dimuat turun!', { id: toastId });
    } catch (err: any) {
      console.error('PDF generation error:', err);
      toast.error('Gagal menjana fail terus. Membuka dialog cetakan...', { id: toastId });
      handlePrintToPdf();
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleShare = () => {
    if (typeof window !== 'undefined') {
      const url = window.location.href;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url);
        setCopiedLink(true);
        toast.success('Pautan Dokumen OPR (PDF) disalin!');
        setTimeout(() => setCopiedLink(false), 2000);
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white p-6">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-sm font-semibold tracking-wide text-slate-300">Memuatkan Dokumen OPR (PDF)...</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white p-6">
        <div className="bg-slate-800 p-8 rounded-xl max-w-md text-center border border-slate-700">
          <FileText size={48} className="text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">Laporan Tidak Dijumpai</h2>
          <p className="text-sm text-slate-400 mb-6">Dokumen OPR ini mungkin telah dipadamkan atau pautan tidak sah.</p>
          {onBackToDashboard && (
            <button
              onClick={onBackToDashboard}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm px-5 py-2.5 rounded-lg transition-colors"
            >
              Kembali ke Halaman Utama
            </button>
          )}
        </div>
      </div>
    );
  }

  const title = report.namaProgram || report.singkatanProgram || report.namaLaporan || 'One Page Report';

  // 1. Cover Page
  const renderCover = () => (
    <div 
      ref={coverPageRef}
      className="pdf-a4-page relative w-[210mm] h-[297mm] min-h-[297mm] max-h-[297mm] bg-white overflow-hidden shadow-2xl mx-auto print:shadow-none print:m-0 cover-page-container"
      style={{ boxSizing: 'border-box' }}
    >
      {activeCover ? (
        <>
          <img 
            src={activeCover} 
            alt="Cover Page" 
            className="absolute inset-0 w-full h-full object-cover z-0" 
          />
          
          {/* Logo-logo di atas */}
          {activeLogos.length > 0 && (
            <div 
              className="absolute left-0 right-0 z-20 flex flex-row items-center justify-center flex-nowrap px-6 pointer-events-none" 
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

          {/* Kotak 1: Tajuk Program */}
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
                fontSize: title.length > 40 ? '11pt' : '11.5pt', 
                fontFamily: 'Arial, sans-serif', 
                fontWeight: 'bold', 
                color: '#000000', 
                lineHeight: 1.25,
                textAlign: 'center'
              }}
            >
              {title.toUpperCase()}
            </p>
          </div>

          {/* Kotak 2: Tarikh Pelaksanaan */}
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

          {/* Kotak 3: Tempat Pelaksanaan */}
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

          {/* QR Code di bawah sebelah kiri */}
          <div 
            className="absolute z-20 flex items-center justify-start pointer-events-auto" 
            style={{ bottom: '0.4%', left: '1.5%' }}
          >
            <CoverQrBadge 
              reportId={report?.id || reportId}
              namaProgram={title}
            />
          </div>
        </>
      ) : (
        <div className="p-10 flex flex-col items-center justify-between h-full text-center text-black" style={{ color: '#000000' }}>
          <div>
            <h1 className="text-xl font-bold uppercase text-black" style={{ color: '#000000' }}>ONE PAGE REPORT (OPR)</h1>
            <p className="text-sm font-semibold text-black uppercase" style={{ color: '#000000' }}>SEKOLAH KEBANGSAAN TUDAN, MIRI</p>
            <div className="w-16 h-1 bg-black mx-auto my-3"></div>
            <h2 className="text-base font-bold uppercase text-black" style={{ color: '#000000' }}>{title}</h2>
          </div>
          <div className="w-full max-w-md border border-black p-4 rounded-lg bg-slate-50 text-left text-sm space-y-2 text-black" style={{ color: '#000000' }}>
            <p className="text-black" style={{ color: '#000000' }}><strong className="text-black" style={{ color: '#000000' }}>Program:</strong> {title}</p>
            <p className="text-black" style={{ color: '#000000' }}><strong className="text-black" style={{ color: '#000000' }}>Tarikh:</strong> {report.tarikhPelaksanaan || '-'}</p>
            <p className="text-black" style={{ color: '#000000' }}><strong className="text-black" style={{ color: '#000000' }}>Tempat:</strong> {report.tempat || '-'}</p>
          </div>
          <div>
            <CoverQrBadge reportId={report?.id || reportId} namaProgram={title} />
          </div>
        </div>
      )}
    </div>
  );

  // 2. OPR Table Page (with 1-inch top padding)
  const renderOpr = () => (
    <div 
      ref={oprPageRef}
      className="pdf-a4-page relative w-[210mm] min-h-[297mm] bg-white overflow-hidden shadow-2xl mx-auto print:shadow-none print:m-0 opr-page-container px-8 pb-8 text-black"
      style={{ boxSizing: 'border-box', paddingTop: '1in', fontSize: '11pt', lineHeight: 1.4, fontFamily: 'Arial, sans-serif', color: '#000000' }}
    >
      {/* Tajuk Rasmi OPR */}
      <div className="text-center mt-0 mb-3 border-b border-gray-300 pb-2 text-black">
        <h2 className="text-lg font-bold uppercase tracking-wider text-black m-0" style={{ letterSpacing: '0.04em', lineHeight: 1.15, color: '#000000' }}>
          ONE PAGE REPORT (OPR)
        </h2>
        <p className="text-xs font-semibold uppercase text-black m-0 mt-0.5" style={{ color: '#000000' }}>
          SEKOLAH KEBANGSAAN TUDAN, MIRI
        </p>
      </div>

      <table className="w-full border-collapse border border-black mb-3 text-black" style={{ fontSize: '11pt', lineHeight: 1.15, fontFamily: 'Arial, sans-serif', color: '#000000' }}>
        <thead>
          <tr className="bg-gray-100 text-black" style={{ color: '#000000' }}>
            <th className="border border-black p-1 font-bold text-center text-black" style={{ width: '6%', color: '#000000' }}>BIL</th>
            <th className="border border-black p-1 font-bold text-center text-black" style={{ width: '22%', color: '#000000' }}>PERKARA</th>
            <th className="border border-black p-1 font-bold text-center text-black" style={{ width: '72%', color: '#000000' }}>MAKLUMAT</th>
          </tr>
        </thead>
        <tbody className="text-black" style={{ color: '#000000' }}>
          <tr style={{ color: '#000000' }}>
            <td className="border border-black p-1 text-center font-bold text-black" style={{ color: '#000000' }}>1</td>
            <td className="border border-black p-1 font-bold text-black" style={{ color: '#000000' }}>Nama Program</td>
            <td className="border border-black p-1 text-justify font-semibold text-black" style={{ color: '#000000' }}>{title}</td>
          </tr>
          <tr style={{ color: '#000000' }}>
            <td className="border border-black p-1 text-center font-bold text-black" style={{ color: '#000000' }}>2</td>
            <td className="border border-black p-1 font-bold text-black" style={{ color: '#000000' }}>Tarikh Pelaksanaan</td>
            <td className="border border-black p-1 text-justify text-black" style={{ color: '#000000' }}>{report.tarikhPelaksanaan || '-'}</td>
          </tr>
          <tr style={{ color: '#000000' }}>
            <td className="border border-black p-1 text-center font-bold text-black" style={{ color: '#000000' }}>3</td>
            <td className="border border-black p-1 font-bold text-black" style={{ color: '#000000' }}>Tempat</td>
            <td className="border border-black p-1 text-justify text-black" style={{ color: '#000000' }}>{report.tempat || '-'}</td>
          </tr>
          <tr style={{ color: '#000000' }}>
            <td className="border border-black p-1 text-center font-bold text-black" style={{ color: '#000000' }}>4</td>
            <td className="border border-black p-1 font-bold text-black" style={{ color: '#000000' }}>Sasaran</td>
            <td className="border border-black p-1 text-justify text-black" style={{ color: '#000000' }}>{report.sasaran || '-'}</td>
          </tr>
          <tr style={{ color: '#000000' }}>
            <td className="border border-black p-1 text-center font-bold text-black" style={{ color: '#000000' }}>5</td>
            <td className="border border-black p-1 font-bold text-black" style={{ color: '#000000' }}>Anjuran</td>
            <td className="border border-black p-1 text-justify text-black" style={{ color: '#000000' }}>{report.anjuran || '-'}</td>
          </tr>
          <tr style={{ color: '#000000' }}>
            <td className="border border-black p-1 text-center font-bold text-black" style={{ color: '#000000' }}>6</td>
            <td className="border border-black p-1 font-bold text-black" style={{ color: '#000000' }}>Objektif</td>
            <td className="border border-black p-1 whitespace-pre-wrap text-justify text-black" style={{ color: '#000000' }}>{report.objektif || '-'}</td>
          </tr>
          <tr style={{ color: '#000000' }}>
            <td className="border border-black p-1 text-center font-bold text-black" style={{ color: '#000000' }}>7</td>
            <td className="border border-black p-1 font-bold text-black" style={{ color: '#000000' }}>Kekuatan</td>
            <td className="border border-black p-1 whitespace-pre-wrap text-justify text-black" style={{ color: '#000000' }}>{report.kekuatan || '-'}</td>
          </tr>
          <tr style={{ color: '#000000' }}>
            <td className="border border-black p-1 text-center font-bold text-black" style={{ color: '#000000' }}>8</td>
            <td className="border border-black p-1 font-bold text-black" style={{ color: '#000000' }}>Perkara Perlu Penambahbaikan</td>
            <td className="border border-black p-1 whitespace-pre-wrap text-justify text-black" style={{ color: '#000000' }}>{report.perkaraPerluPenambahbaikan || '-'}</td>
          </tr>
          <tr style={{ color: '#000000' }}>
            <td className="border border-black p-1 text-center font-bold text-black" style={{ color: '#000000' }}>9</td>
            <td className="border border-black p-1 font-bold text-black" style={{ color: '#000000' }}>Cadangan Penambahbaikan</td>
            <td className="border border-black p-1 whitespace-pre-wrap text-justify text-black" style={{ color: '#000000' }}>{report.cadanganPenambahbaikan || '-'}</td>
          </tr>
          {report.penilaianKeberkesanan && (
            <tr style={{ color: '#000000' }}>
              <td className="border border-black p-1 text-center font-bold text-black" style={{ color: '#000000' }}>10</td>
              <td className="border border-black p-1 font-bold text-black" style={{ color: '#000000' }}>Penilaian Keberkesanan</td>
              <td className="border border-black p-1 whitespace-pre-wrap text-justify text-black" style={{ color: '#000000' }}>{report.penilaianKeberkesanan}</td>
            </tr>
          )}
          <tr style={{ color: '#000000' }}>
            <td className="border border-black p-1 text-center font-bold text-black" style={{ color: '#000000' }}>{report.penilaianKeberkesanan ? '11' : '10'}</td>
            <td className="border border-black p-1 font-bold text-black" style={{ color: '#000000' }}>Gambar Pelaksanaan</td>
            <td className="border border-black p-1 text-black" style={{ color: '#000000' }}>
              {report.gambarProgram && report.gambarProgram.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 my-1">
                  {report.gambarProgram.map((url: string, index: number) => (
                    <div key={index} className="flex flex-col items-center">
                      <div className="h-[75px] w-full border border-dashed border-gray-400 overflow-hidden flex items-center justify-center bg-gray-50">
                        <img src={url} alt={`Gambar ${index + 1}`} className="max-w-full max-h-full object-contain" />
                      </div>
                      {report.peneranganGambar && report.peneranganGambar[index] && (
                        <p className="text-[9pt] text-center italic mt-0.5 leading-tight text-black" style={{ color: '#000000' }}>{report.peneranganGambar[index]}</p>
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

      {/* Tandatangan Pengesahan */}
      <div className="flex justify-between mt-5 px-6 text-black" style={{ fontSize: '11pt', lineHeight: 1.1, color: '#000000' }}>
        <div className="text-left w-2/5 text-black" style={{ color: '#000000' }}>
          <p className="mb-8 text-black" style={{ color: '#000000' }}>Disediakan oleh:</p>
          <div className="border-t border-black pt-1">
            <p className="font-bold uppercase m-0 text-black" style={{ color: '#000000' }}>{report.disediakanOleh || ' '}</p>
            <p className="m-0 text-sm text-black" style={{ color: '#000000' }}>{report.jawatanDisediakanOleh || ' '}</p>
          </div>
        </div>
        <div className="text-left w-2/5 text-black" style={{ color: '#000000' }}>
          <p className="mb-8 text-black" style={{ color: '#000000' }}>Disahkan oleh:</p>
          <div className="border-t border-black pt-1">
            <p className="font-bold uppercase m-0 text-black" style={{ color: '#000000' }}>{report.disahkanOleh || ' '}</p>
            <p className="m-0 text-sm text-black" style={{ color: '#000000' }}>{report.jawatanDisahkanOleh || ' '}</p>
          </div>
        </div>
      </div>
    </div>
  );

  // 3. Back Cover Page
  const renderBackCover = () => (
    <div 
      ref={backCoverPageRef}
      className="pdf-a4-page relative w-[210mm] h-[297mm] min-h-[297mm] max-h-[297mm] bg-white overflow-hidden shadow-2xl mx-auto print:shadow-none print:m-0 back-cover-page-container"
      style={{ boxSizing: 'border-box' }}
    >
      {activeBackCover ? (
        <>
          <img 
            src={activeBackCover} 
            alt="Cover Belakang" 
            className="w-full h-full object-cover absolute inset-0" 
          />
          <div 
            className="absolute z-20 flex items-center justify-center pointer-events-auto" 
            style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '100%' }}
          >
            <CoverQrBadge 
              reportId={report?.id || reportId}
              namaProgram={title}
              isBackCover={true}
            />
          </div>
        </>
      ) : (
        <div 
          className="flex flex-col items-center justify-between p-12 text-center h-full text-black"
          style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 50%, #eff6ff 100%)', color: '#000000' }}
        >
          <div className="w-full pt-4 text-black">
            <p className="text-xs uppercase tracking-widest text-black font-bold mb-1" style={{ color: '#000000' }}>KEMENTERIAN PENDIDIKAN MALAYSIA</p>
            <p className="text-sm uppercase tracking-wider text-black font-bold" style={{ color: '#000000' }}>JABATAN PENDIDIKAN NEGERI SARAWAK</p>
            <p className="text-xs uppercase tracking-wider text-black" style={{ color: '#000000' }}>PEJABAT PENDIDIKAN DAERAH MIRI</p>
          </div>

          <div className="my-auto text-black">
            <h2 className="text-xl font-bold uppercase tracking-wider text-black mb-1" style={{ color: '#000000' }}>SEKOLAH KEBANGSAAN TUDAN</h2>
            <p className="text-sm font-semibold text-black uppercase" style={{ color: '#000000' }}>MIRI, SARAWAK</p>
            <div className="w-16 h-1 bg-black my-4 mx-auto rounded-full"></div>
            <div className="my-4">
              <CoverQrBadge 
                reportId={report?.id || reportId}
                namaProgram={title}
                isBackCover={true}
              />
            </div>
          </div>

          <div className="w-full pb-4 border-t border-gray-400 pt-3 text-black">
            <p className="text-xs font-bold text-black uppercase mb-1" style={{ color: '#000000' }}>"BERILMU • BERAKHLAK • BERJAYA"</p>
            <p className="text-[11px] text-black italic" style={{ color: '#000000' }}>Shine Tudan Shine</p>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans select-none print:bg-white print:text-black">
      {/* Top PDF App Bar (Sticky) */}
      <header className="sticky top-0 z-40 bg-slate-800/95 backdrop-blur-md border-b border-slate-700 px-3 sm:px-6 py-2.5 shadow-md flex items-center justify-between flex-wrap gap-2 print:hidden">
        {/* Left: Branding & Title */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {onBackToDashboard && (
            <button
              onClick={onBackToDashboard}
              className="p-1.5 sm:p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-colors shrink-0"
              title="Kembali ke Sistem OPR"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="bg-red-600 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider">
                PDF
              </span>
              <h1 className="text-xs sm:text-sm font-bold text-white truncate max-w-[200px] sm:max-w-md">
                {title}
              </h1>
            </div>
            <p className="text-[10px] text-slate-400 truncate">
              Dokumen One Page Report (OPR) • SK Tudan
            </p>
          </div>
        </div>

        {/* Center: Scope Tabs */}
        <div className="hidden md:flex items-center gap-1 bg-slate-900/80 p-1 rounded-lg border border-slate-700 text-xs">
          <button
            onClick={() => setActivePageTab('all')}
            className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
              activePageTab === 'all' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Lengkap (3 Halaman)
          </button>
          <button
            onClick={() => setActivePageTab('cover')}
            className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
              activePageTab === 'cover' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Muka Depan
          </button>
          <button
            onClick={() => setActivePageTab('opr')}
            className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
              activePageTab === 'opr' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Jadual OPR
          </button>
          <button
            onClick={() => setActivePageTab('back')}
            className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
              activePageTab === 'back' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Muka Belakang
          </button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Zoom controls */}
          <div className="hidden lg:flex items-center gap-1 bg-slate-900/80 px-2 py-1 rounded-lg border border-slate-700 text-xs text-slate-300 mr-1">
            <button 
              onClick={() => setScale(s => Math.max(0.4, Number((s - 0.1).toFixed(1))))}
              className="p-1 hover:text-white rounded hover:bg-slate-800"
              title="Zum Keluar"
            >
              <ZoomOut size={14} />
            </button>
            <span className="w-10 text-center font-mono text-[11px]">{Math.round(scale * 100)}%</span>
            <button 
              onClick={() => setScale(s => Math.min(1.5, Number((s + 0.1).toFixed(1))))}
              className="p-1 hover:text-white rounded hover:bg-slate-800"
              title="Zum Masuk"
            >
              <ZoomIn size={14} />
            </button>
            <button 
              onClick={() => setScale(1)}
              className="p-1 hover:text-white rounded hover:bg-slate-800 ml-0.5"
              title="Set Semula Zum"
            >
              <RotateCcw size={13} />
            </button>
          </div>

          {/* Share */}
          <button
            onClick={handleShare}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-colors text-xs"
            title="Salin Pautan PDF"
          >
            {copiedLink ? <Check size={16} className="text-emerald-400" /> : <Share2 size={16} />}
          </button>

          {/* Download PDF file button */}
          <button
            onClick={handleDownloadPdfFile}
            disabled={isGeneratingPdf}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs sm:text-sm font-bold px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg transition-all shadow-sm disabled:opacity-50"
            title="Muat Turun Fail PDF (.pdf)"
          >
            <Download size={16} />
            <span>{isGeneratingPdf ? 'Menjana...' : 'Muat Turun PDF'}</span>
          </button>

          {/* Print to PDF button */}
          <button
            onClick={handlePrintToPdf}
            className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs sm:text-sm font-bold px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg transition-all shadow-sm"
            title="Cetak Dokumen OPR (A4)"
          >
            <Printer size={16} />
            <span>Print to PDF</span>
          </button>
        </div>
      </header>

      {/* Main Document Viewer Container */}
      <main className="flex-1 overflow-x-auto overflow-y-auto p-4 sm:p-8 flex flex-col items-center justify-start print:p-0 print:m-0 print:overflow-visible bg-slate-900">
        <div 
          ref={containerRef}
          className="flex flex-col items-center gap-8 transition-transform origin-top print:gap-0 print:transform-none"
          style={{ transform: `scale(${scale})` }}
        >
          {(activePageTab === 'all' || activePageTab === 'cover') && (
            <div className="flex flex-col items-center">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2 print:hidden">
                Halaman 1: Muka Depan Rasmi
              </span>
              {renderCover()}
            </div>
          )}

          {(activePageTab === 'all' || activePageTab === 'opr') && (
            <div className="flex flex-col items-center">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2 print:hidden">
                Halaman 2: Jadual One Page Report (OPR)
              </span>
              {renderOpr()}
            </div>
          )}

          {(activePageTab === 'all' || activePageTab === 'back') && (
            <div className="flex flex-col items-center">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2 print:hidden">
                Halaman 3: Muka Belakang
              </span>
              {renderBackCover()}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
