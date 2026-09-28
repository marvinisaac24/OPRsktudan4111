import React from 'react';
import { Calendar, MapPin, QrCode } from 'lucide-react';

interface ReportCoverThumbnailProps {
  report: any;
  coverTemplate?: string;
  systemLogos?: string[];
  className?: string;
}

export default function ReportCoverThumbnail({
  report,
  coverTemplate = '',
  systemLogos = [],
  className = '',
}: ReportCoverThumbnailProps) {
  // Support both gambarMukaDepan (Firestore storage format) and coverTemplate (settings format)
  const cachedCover = typeof window !== 'undefined' ? (localStorage.getItem('cachedCoverTemplate') || '') : '';
  const activeCover = report?.gambarMukaDepan || report?.coverTemplate || coverTemplate || cachedCover;

  const rawLogos = Array.isArray(report?.logos) && report.logos.length > 0
    ? report.logos
    : (systemLogos.length > 0 ? systemLogos : (report?.logoSekolah ? [report.logoSekolah] : []));
  let activeLogos = rawLogos.filter((l: string) => l && typeof l === 'string' && l.trim() !== '');

  if (activeLogos.length === 0 && typeof window !== 'undefined') {
    try {
      const cached = JSON.parse(localStorage.getItem('cachedSystemLogos') || '[]');
      if (Array.isArray(cached)) activeLogos = cached.filter((l: string) => l && typeof l === 'string' && l.trim() !== '');
    } catch {}
  }

  const title = report?.namaProgram || report?.singkatanProgram || report?.namaLaporan || 'Tanpa Tajuk';
  const tarikh = report?.tarikhPelaksanaan || '-';
  const tempat = report?.tempat || '-';

  return (
    <div 
      className={`relative w-full overflow-hidden select-none bg-white transition-all ${className}`}
      style={{ aspectRatio: '1 / 1.414' }}
    >
      {activeCover ? (
        <>
          {/* Background Cover Template Image */}
          <img 
            src={activeCover} 
            alt="Muka Depan OPR" 
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            loading="lazy"
          />

          {/* Logo-logo Di Atas Sekali Mengikut Urutan Rasmi */}
          {activeLogos.length > 0 && (
            <div 
              className="absolute left-0 right-0 z-10 flex items-center justify-center flex-nowrap px-3 pointer-events-none overflow-hidden" 
              style={{ 
                top: '4.8%', 
                height: '7.5%', 
                gap: activeLogos.length > 4 ? '4px' : '6px' 
              }}
            >
              {activeLogos.map((l: string, idx: number) => {
                const isCurtin = idx === 4 || l.toLowerCase().includes('curtin');
                const userScale = report?.logoScales?.[idx] || 1.0;
                return (
                  <div key={idx} className="h-full flex items-center justify-center flex-shrink-0" style={{ maxWidth: isCurtin ? '25%' : '18%' }}>
                    <img 
                      src={l} 
                      alt={`Logo ${idx + 1}`} 
                      className="max-h-full max-w-full object-contain"
                      style={{ transform: `scale(${userScale})` }}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Kotak 1: TAJUK PROGRAM - Tepat di tengah ruang putih kotak Tajuk Program dalam 2 baris seimbang */}
          <div 
            className="absolute z-10 flex items-center justify-center px-1.5 pointer-events-none" 
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
              className="font-extrabold text-black m-0 leading-tight text-center uppercase line-clamp-2 w-full tracking-normal"
              style={{ 
                fontSize: 'clamp(7.5px, 1.15vw, 11px)', 
                lineHeight: 1.2, 
                fontFamily: 'Arial, sans-serif',
                color: '#000000',
                textAlign: 'center'
              }}
              title={title.toUpperCase()}
            >
              {title.toUpperCase()}
            </p>
          </div>

          {/* Kotak 2: TARIKH - Tepat di tengah ruang putih kotak Tarikh secara mendatar & menegak */}
          <div 
            className="absolute z-10 flex items-center justify-center px-1.5 pointer-events-none" 
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
              className="font-bold text-black m-0 leading-tight text-center w-full truncate uppercase"
              style={{ 
                fontSize: 'clamp(7.5px, 1.15vw, 11px)', 
                lineHeight: 1.2, 
                fontFamily: 'Arial, sans-serif',
                color: '#000000',
                textAlign: 'center'
              }}
              title={tarikh.toUpperCase()}
            >
              {tarikh.toUpperCase()}
            </p>
          </div>

          {/* Kotak 3: TEMPAT - Tepat di tengah ruang putih kotak Tempat secara mendatar & menegak */}
          <div 
            className="absolute z-10 flex items-center justify-center px-1.5 pointer-events-none" 
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
              className="font-bold text-black m-0 leading-tight text-center line-clamp-1 w-full truncate uppercase"
              style={{ 
                fontSize: 'clamp(7.5px, 1.15vw, 11px)', 
                lineHeight: 1.2, 
                fontFamily: 'Arial, sans-serif',
                color: '#000000',
                textAlign: 'center'
              }}
              title={tempat.toUpperCase()}
            >
              {tempat.toUpperCase()}
            </p>
          </div>

          {/* Mini QR Badge di Bawah Kiri */}
          <div 
            className="absolute z-10 flex items-center gap-1 bg-white/95 border border-slate-300 rounded px-1 py-0.5 shadow-2xs pointer-events-none" 
            style={{ bottom: '1.2%', left: '2.5%' }}
          >
            <QrCode size={10} className="text-blue-700 shrink-0" />
            <span className="text-[6.5px] font-bold text-blue-900 uppercase tracking-tighter">QR OPR</span>
          </div>
        </>
      ) : (
        /* Fallback Jika Belum Ada Templat Gambar: Reka Bentuk Muka Depan Berstruktur Rasmi */
        <div className="absolute inset-0 p-4 flex flex-col justify-between items-center text-center bg-gradient-to-b from-blue-900 via-blue-800 to-slate-900 text-white">
          <div className="w-full pt-1">
            <p className="text-[8px] uppercase tracking-widest text-blue-200 font-semibold m-0">KEMENTERIAN PENDIDIKAN MALAYSIA</p>
            <h4 className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-white mt-0.5 mb-1">SEKOLAH KEBANGSAAN TUDAN, MIRI</h4>
            <div className="w-10 h-0.5 bg-amber-400 mx-auto rounded-full"></div>
          </div>

          <div className="my-auto w-full px-2">
            <span className="inline-block bg-amber-400 text-slate-950 font-black text-[8px] uppercase px-2 py-0.5 rounded shadow-xs mb-2">
              ONE PAGE REPORT (OPR)
            </span>
            
            <div className="bg-white/10 backdrop-blur-xs border border-white/20 rounded-lg p-2.5 shadow-inner text-left space-y-1.5">
              <div className="border-b border-white/10 pb-1">
                <span className="text-[7px] text-amber-300 uppercase font-bold block">Nama Program:</span>
                <p className="text-[9px] sm:text-[10px] font-bold text-white uppercase line-clamp-2 m-0 leading-tight">
                  {title}
                </p>
              </div>
              <div className="flex items-center gap-1 text-[7.5px] text-blue-100">
                <Calendar size={9} className="text-amber-400 shrink-0" />
                <span className="truncate">{tarikh}</span>
              </div>
              <div className="flex items-center gap-1 text-[7.5px] text-blue-100">
                <MapPin size={9} className="text-amber-400 shrink-0" />
                <span className="truncate">{tempat}</span>
              </div>
            </div>
          </div>

          <div className="w-full pb-1 border-t border-white/10 pt-1">
            <p className="text-[6.5px] text-blue-200 uppercase tracking-widest font-semibold m-0">"BERILMU • BERAKHLAK • BERJAYA"</p>
          </div>
        </div>
      )}
    </div>
  );
}
