import React, { useState, useEffect } from 'react';
import { getReportDigitalUrl, generateQrDataUrl } from '../utils/qrCodeHelper';
import { QrCode, ExternalLink, Check, Copy } from 'lucide-react';
import toast from 'react-hot-toast';

interface CoverQrBadgeProps {
  reportId?: string;
  namaProgram?: string;
  compact?: boolean;
  isBackCover?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export default function CoverQrBadge({
  reportId,
  namaProgram,
  compact = false,
  isBackCover = false,
  className = '',
  style = {},
}: CoverQrBadgeProps) {
  const [qrUrl, setQrUrl] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  const digitalUrl = getReportDigitalUrl(reportId, namaProgram);
  const displayUrl = digitalUrl.replace(/^https?:\/\//, '');
  const title = namaProgram || 'Laporan OPR SK Tudan';

  useEffect(() => {
    let isMounted = true;
    generateQrDataUrl(digitalUrl).then((url) => {
      if (isMounted) setQrUrl(url);
    });
    return () => {
      isMounted = false;
    };
  }, [digitalUrl]);

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(digitalUrl);
      setCopied(true);
      toast.success('Pautan OPR disalin ke papan klip!', { duration: 2500 });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!qrUrl) {
    return null;
  }

  // Back cover prominent centered badge
  if (isBackCover) {
    return (
      <div
        onClick={() => {
          window.open(digitalUrl, '_blank');
        }}
        className={`flex flex-col items-center justify-center text-center bg-white/95 backdrop-blur-xs border-2 border-blue-900 rounded-2xl p-5 sm:p-6 shadow-xl max-w-sm w-[90%] mx-auto pointer-events-auto cursor-pointer hover:shadow-2xl transition-all print:border-blue-900 print:shadow-none ${className}`}
        style={style}
        title={`Klik atau imbas untuk membuka Dokumen OPR (PDF): ${digitalUrl}`}
      >
        <div className="bg-white p-2 rounded-xl border border-slate-300 shadow-xs mb-3 flex items-center justify-center">
          <img
            src={qrUrl}
            alt="QR Code Laporan OPR"
            className="w-24 h-24 sm:w-28 sm:h-28 object-contain block"
          />
        </div>

        <div className="flex items-center gap-1.5 mb-1 text-blue-900 print:text-black">
          <QrCode size={16} className="text-blue-700 print:text-black shrink-0" />
          <span className="text-xs sm:text-sm font-bold uppercase tracking-wider print:text-black">
            Imbas QR: Dokumen OPR
          </span>
          <span className="bg-red-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-2xs">
            PDF
          </span>
        </div>

        <p className="text-xs sm:text-sm font-bold text-slate-800 print:text-black line-clamp-2 mb-2 max-w-[280px]">
          {title}
        </p>

        <div className="flex items-center justify-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 w-full max-w-[300px]">
          <a
            href={digitalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] sm:text-xs text-blue-600 hover:text-blue-800 underline truncate font-mono"
            title={digitalUrl}
            onClick={(e) => e.stopPropagation()}
          >
            {displayUrl}
          </a>
          <button
            type="button"
            onClick={handleCopyLink}
            className="print:hidden p-1 hover:bg-blue-100 text-slate-500 hover:text-blue-700 rounded transition-colors shrink-0"
            title="Salin pautan OPR ini"
          >
            {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
          </button>
        </div>

        <p className="text-[10px] text-slate-500 italic mt-2.5 mb-0">
          Imbas untuk membuka & memuat turun dokumen OPR rasmi dalam format PDF
        </p>
      </div>
    );
  }

  if (compact) {
    return (
      <div
        onClick={() => {
          window.open(digitalUrl, '_blank');
        }}
        className={`inline-flex items-center gap-1 bg-white/95 backdrop-blur-xs border border-slate-300/90 rounded-md px-1 py-0.5 shadow-2xs pointer-events-auto cursor-pointer hover:border-blue-500 transition-all ${className}`}
        style={style}
        title={`Klik atau imbas untuk membuka Dokumen OPR (PDF): ${digitalUrl}`}
      >
        <div className="shrink-0 bg-white p-0.5 rounded border border-slate-200">
          <img src={qrUrl} alt="QR Code" className="w-6 h-6 object-contain block" />
        </div>
        <div className="text-left font-sans leading-none min-w-0 max-w-[120px]">
          <p className="text-[6px] font-bold text-blue-900 uppercase tracking-wider truncate m-0 flex items-center gap-0.5">
            <span>QR OPR</span>
            <span className="bg-red-600 text-white text-[5px] px-0.5 rounded font-bold">PDF</span>
          </p>
          <p className="text-[5.5px] text-slate-700 truncate font-medium m-0">
            {title}
          </p>
          <p className="text-[5px] text-blue-600 truncate underline m-0">
            {displayUrl}
          </p>
        </div>
      </div>
    );
  }

  // Front cover sleek, low-profile badge (placed at very bottom left so it never overlaps text)
  return (
    <div
      onClick={() => {
        window.open(digitalUrl, '_blank');
      }}
      className={`inline-flex items-center gap-2 bg-white/95 backdrop-blur-xs border border-slate-300/90 rounded-md px-2 py-1 shadow-sm pointer-events-auto hover:bg-white hover:border-blue-400 cursor-pointer transition-all print:border-slate-300 print:shadow-none ${className}`}
      style={style}
      title={`Klik atau imbas untuk membuka Dokumen OPR (PDF): ${digitalUrl}`}
    >
      {/* QR Code Graphic */}
      <div className="shrink-0 bg-white p-0.5 rounded border border-slate-200 shadow-2xs flex items-center justify-center">
        <img
          src={qrUrl}
          alt="QR Code Laporan OPR PDF"
          className="w-8 h-8 sm:w-9 sm:h-9 object-contain block"
        />
      </div>

      {/* Info & Link */}
      <div className="text-left font-sans leading-tight min-w-0 max-w-[220px] sm:max-w-[280px]">
        <div className="flex items-center gap-1 mb-0.5">
          <QrCode size={10} className="text-blue-700 print:text-black shrink-0" />
          <span className="text-[7.5px] sm:text-[8px] font-bold uppercase tracking-wider text-blue-900 print:text-black">
            Imbas QR: OPR (PDF)
          </span>
          <span className="bg-red-600 text-white text-[6px] font-bold px-1 py-0.2 rounded">
            PDF
          </span>
        </div>
        <p className="text-[7px] sm:text-[7.5px] font-semibold text-slate-800 print:text-black truncate m-0 mb-0.5" title={title}>
          {title}
        </p>
        <div className="flex items-center gap-1">
          <a
            href={digitalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[6.5px] sm:text-[7px] text-blue-600 hover:text-blue-800 underline truncate max-w-[190px] inline-block font-mono"
            title={digitalUrl}
            onClick={(e) => e.stopPropagation()}
          >
            {displayUrl}
          </a>
          <button
            type="button"
            onClick={handleCopyLink}
            className="print:hidden p-0.5 hover:bg-blue-50 text-slate-500 hover:text-blue-600 rounded transition-colors shrink-0"
            title="Salin pautan OPR ini"
          >
            {copied ? <Check size={10} className="text-emerald-600" /> : <Copy size={10} />}
          </button>
        </div>
      </div>
    </div>
  );
}
