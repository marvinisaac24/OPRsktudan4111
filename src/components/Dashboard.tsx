import React, { useState, useEffect, useRef } from 'react';
import { db, auth } from '../firebase';
import { deleteReportWithMedia, batchHydrateReportMedia } from '../services/reportStorageService';
import { onAuthStateChanged } from 'firebase/auth';
import { disableNetwork, enableNetwork, collection as firestoreCollection, query as firestoreQuery, onSnapshot as firestoreOnSnapshot, orderBy as firestoreOrderBy, deleteDoc as firestoreDeleteDoc, doc as firestoreDoc, getDoc as firestoreGetDoc } from 'firebase/firestore';
import { Plus, FileText, Trash2, Edit2, Calendar, Search, BarChart3, Printer, CheckSquare, Square, Download, WifiOff, Wifi, Eye, LayoutGrid, ChevronLeft, ChevronRight, ExternalLink, MapPin, BookOpen, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import * as d3 from 'd3';
import { generateQrDataUrl, getCoverQrHtmlBadge, getBackCoverQrHtmlBadge, getReportDigitalUrl } from '../utils/qrCodeHelper';
import ReportCoverThumbnail from './ReportCoverThumbnail';

interface DashboardProps {
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onCreate: () => void;
}

function ReportActivityChart({ reports }: { reports: any[] }) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current || reports.length === 0) return;
    
    const monthCounts = new Map<string, { month: string, count: number, dateObj: Date }>();
    
    reports.forEach(report => {
      let date = new Date();
      if (report.createdAt?.toDate) {
        date = report.createdAt.toDate();
      } else if (report.tarikhPelaksanaan) {
         const parsed = new Date(report.tarikhPelaksanaan);
         if (!isNaN(parsed.getTime())) date = parsed;
      }
      
      const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
      const monthLabel = date.toLocaleString('default', { month: 'short', year: '2-digit' });
      
      if (!monthCounts.has(monthKey)) {
        monthCounts.set(monthKey, { month: monthLabel, count: 0, dateObj: new Date(date.getFullYear(), date.getMonth(), 1) });
      }
      monthCounts.get(monthKey)!.count += 1;
    });
    
    const sortedData = Array.from(monthCounts.values())
      .sort((a,b) => a.dateObj.getTime() - b.dateObj.getTime());

    d3.select(chartRef.current).selectAll("*").remove();

    const margin = { top: 10, right: 10, bottom: 20, left: 30 };
    const width = chartRef.current.clientWidth - margin.left - margin.right;
    const height = 180 - margin.top - margin.bottom;

    const svg = d3.select(chartRef.current)
      .append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      .range([0, width])
      .padding(0.3);

    const y = d3.scaleLinear()
      .range([height, 0]);

    x.domain(sortedData.map(d => d.month));
    const maxCount = d3.max(sortedData, d => d.count) || 0;
    y.domain([0, maxCount + Math.ceil(maxCount * 0.2)]); // add 20% headroom

    svg.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).tickSizeOuter(0))
      .style("font-family", "Inter, sans-serif")
      .style("font-size", "11px")
      .attr("color", "#6b7280");

    const yAxis = svg.append("g")
      .call(d3.axisLeft(y).ticks(Math.min(5, maxCount)).tickFormat(d3.format("d")));

    yAxis.selectAll(".tick line")
       .attr("stroke", "#f3f4f6")
       .attr("x2", width);
    yAxis.select(".domain").remove();
    yAxis.selectAll("text")
       .style("font-family", "Inter, sans-serif")
       .style("font-size", "11px")
       .attr("color", "#9ca3af");

    // Add bars
    svg.selectAll(".bar")
      .data(sortedData)
      .enter().append("rect")
      .attr("class", "bar")
      .attr("x", d => x(d.month) || 0)
      .attr("width", x.bandwidth())
      .attr("y", d => y(0))
      .attr("height", 0)
      .attr("fill", "#3b82f6")
      .attr("rx", 4)
      .transition()
      .duration(800)
      .ease(d3.easeCubicOut)
      .attr("y", d => y(d.count))
      .attr("height", d => height - y(d.count));
      
    // Add value labels on top of bars
    svg.selectAll(".label")
      .data(sortedData)
      .enter().append("text")
      .attr("class", "label")
      .attr("x", d => (x(d.month) || 0) + x.bandwidth() / 2)
      .attr("y", d => y(d.count) - 5)
      .attr("text-anchor", "middle")
      .style("font-size", "10px")
      .style("font-family", "Inter, sans-serif")
      .style("font-weight", "600")
      .attr("fill", "#4b5563")
      .style("opacity", 0)
      .text(d => d.count)
      .transition()
      .delay(800)
      .duration(400)
      .style("opacity", 1);
      
  }, [reports]);

  if (reports.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
          <BarChart3 size={18} />
        </div>
        <h3 className="font-semibold text-gray-900">Aktiviti Laporan (Bulanan)</h3>
      </div>
      <div ref={chartRef} className="w-full h-[180px]" />
    </div>
  );
}

export default function Dashboard({ onView, onEdit, onCreate }: DashboardProps) {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [reportToDelete, setReportToDelete] = useState<string | null>(null);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedReports, setSelectedReports] = useState<Set<string>>(new Set());
  const [coverTemplate, setCoverTemplate] = useState<string>(() => {
    try {
      return localStorage.getItem('cachedCoverTemplate') || '';
    } catch {
      return '';
    }
  });
  const [backCoverTemplate, setBackCoverTemplate] = useState<string>(() => {
    try {
      return localStorage.getItem('cachedBackCoverTemplate') || '';
    } catch {
      return '';
    }
  });
  const [systemLogos, setSystemLogos] = useState<string[]>(() => {
    try {
      const cached = JSON.parse(localStorage.getItem('cachedSystemLogos') || '[]');
      return Array.isArray(cached) ? cached : [];
    } catch {
      return [];
    }
  });
  const [dashboardViewMode, setDashboardViewMode] = useState<'grid' | 'opr'>(() => {
    try {
      return (localStorage.getItem('dashboardViewMode') as 'grid' | 'opr') || 'grid';
    } catch {
      return 'grid';
    }
  });
  const [oprDocTab, setOprDocTab] = useState<'all' | 'cover' | 'table'>('all');
  const [activeOprIndex, setActiveOprIndex] = useState<number>(0);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isForcedOffline, setIsForcedOffline] = useState(() => {
    return localStorage.getItem('forcedOffline') === 'true';
  });

  const handleToggleOffline = async () => {
    try {
      if (isForcedOffline) {
        await enableNetwork(db);
        setIsForcedOffline(false);
        localStorage.removeItem('forcedOffline');
        toast.success("Mod dalam talian diaktifkan (Online)");
      } else {
        await disableNetwork(db);
        setIsForcedOffline(true);
        localStorage.setItem('forcedOffline', 'true');
        toast.success("Mod luar talian diaktifkan (Forced Offline)");
      }
    } catch (e) {
      console.error("Error toggling network:", e);
      toast.error('Gagal menukar mod rangkaian');
    }
  };

  useEffect(() => {
    // Apabila komponen dimuatkan, jika force offline telah diaktifkan, kita lumpuhkan network
    if (isForcedOffline) {
      disableNetwork(db).catch(console.error);
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settingsSnap = await firestoreGetDoc(firestoreDoc(db, 'settings', 'global'));
        if (settingsSnap.exists()) {
          const sData = settingsSnap.data();
          if (sData.coverTemplate) {
            setCoverTemplate(sData.coverTemplate);
            localStorage.setItem('cachedCoverTemplate', sData.coverTemplate);
          }
          if (sData.backCoverTemplate) {
            setBackCoverTemplate(sData.backCoverTemplate);
            localStorage.setItem('cachedBackCoverTemplate', sData.backCoverTemplate);
          }
          if (Array.isArray(sData.logos)) {
            setSystemLogos(sData.logos);
            localStorage.setItem('cachedSystemLogos', JSON.stringify(sData.logos));
          }
        }
      } catch (err) {
        console.error("Error fetching settings:", err);
      }
    };
    fetchSettings();

    // Langgan koleksi laporan serta-merta tanpa sekatan sesi
    const colRef = firestoreCollection(db, 'reports');
    const unsubscribeSnap = firestoreOnSnapshot(colRef, (snapshot) => {
      const reportsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      reportsData.sort((a: any, b: any) => {
        const getTimestamp = (r: any) => {
          if (r.createdAt?.toMillis) return r.createdAt.toMillis();
          if (r.createdAt?.seconds) return r.createdAt.seconds * 1000;
          if (r.updatedAt?.toMillis) return r.updatedAt.toMillis();
          if (r.updatedAt?.seconds) return r.updatedAt.seconds * 1000;
          if (r.tarikhPelaksanaan) {
            const d = new Date(r.tarikhPelaksanaan).getTime();
            if (!isNaN(d)) return d;
          }
          return 0;
        };
        return getTimestamp(b) - getTimestamp(a);
      });

      setReports(reportsData);
      setLoading(false);

      // Hydrate media in background so every report gets gambarMukaDepan
      batchHydrateReportMedia(reportsData).then((hydrated) => {
        setReports(hydrated);
      }).catch((e) => console.warn("Hydrate background warning:", e));
    }, (error) => {
      console.error("Error fetching reports:", error);
      setLoading(false);
    });

    return () => unsubscribeSnap();
  }, []);

  const confirmDelete = async () => {
    if (reportToDelete) {
      try {
        await deleteReportWithMedia(reportToDelete);
        setReportToDelete(null);
        toast.success("Laporan dan media berjaya dipadamkan.");
      } catch (error) {
        console.error("Error deleting report:", error);
        toast.error("Ralat memadamkan laporan.");
      }
    }
  };

  const handleToggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelected = new Set(selectedReports);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedReports(newSelected);
  };

  const handleDownloadCombinedPdf = async () => {
    const rawList = reports.filter(r => selectedReports.has(r.id));
    if (rawList.length === 0) return;

    const toastId = toast.loading('Menyediakan dokumen & media...');
    const selectedReportsList = await batchHydrateReportMedia(rawList);

    // Generate QR codes for all selected reports
    const qrMap: Record<string, string> = {};
    await Promise.all(
      selectedReportsList.map(async (rep) => {
        try {
          const qrUrl = await generateQrDataUrl(getReportDigitalUrl(rep.id, rep.namaProgram));
          qrMap[rep.id] = qrUrl;
        } catch {
          qrMap[rep.id] = '';
        }
      })
    );

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error("Sila benarkan pop-up untuk mencetak.", { id: toastId });
      return;
    }

    const htmlContent = selectedReportsList.map((report, index) => {
      const activeCover = report.gambarMukaDepan || coverTemplate;
      const activeBackCover = report.gambarMukaBelakang || backCoverTemplate;
      const activeLogos: string[] = (Array.isArray(report.logos) && report.logos.some((l: string) => l && l.trim() !== ''))
        ? report.logos.filter((l: string) => l && l.trim() !== '')
        : (report.logoSekolah ? [report.logoSekolah] : []);
      
      return `
        <div class="report-container" ${index < selectedReportsList.length - 1 ? 'style="page-break-after: always;"' : ''}>
          ${activeCover ? `
            <div class="cover-page-container" style="text-align: center; margin: 0; padding: 0; page-break-after: always; break-after: page; position: relative; width: 100%; height: 297mm; min-height: 297mm; max-height: 297mm; overflow: hidden; display: flex; justify-content: center; align-items: flex-start;">
              <img src="${activeCover}" style="width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0;" />
              ${activeLogos.length > 0 ? `
                <div style="position: absolute; top: 4.8%; left: 0; right: 0; display: flex; justify-content: center; align-items: center; flex-wrap: nowrap; gap: ${activeLogos.length > 4 ? '32px' : '36px'}; width: 100%; height: 76px; pointer-events: none; z-index: 20;">
                  ${activeLogos.map((l: string, idx: number) => {
                    const isKpmLogo = idx === 2 || l.toLowerCase().includes('kpm') || l.toLowerCase().includes('kementerian') || l.toLowerCase().includes('pendidikan');
                    const isYayasan = idx === 3 || l.toLowerCase().includes('yayasan') || l.toLowerCase().includes('sarawak');
                    const isCurtin = idx === 4 || l.toLowerCase().includes('curtin');
                    const userScale = report.logoScales?.[idx] || 1.0;
                    const h = Math.round((isCurtin ? 32 : (isKpmLogo ? 56 : (isYayasan ? 50 : 54))) * userScale);
                    const maxW = Math.round((isCurtin ? 120 : (isKpmLogo || isYayasan ? 78 : 75)) * userScale);
                    return `
                      <div style="display: inline-flex; align-items: center; justify-content: center; height: ${h}px; max-width: ${maxW}px; flex-shrink: 0;">
                        <img src="${l}" alt="Logo ${idx + 1}" style="height: ${h}px; max-height: ${h}px; width: auto; max-width: ${maxW}px; object-fit: contain; display: inline-block; vertical-align: middle;" />
                      </div>
                    `;
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
                ${getCoverQrHtmlBadge(report.id, report.namaProgram || report.singkatanProgram || report.namaLaporan || '', qrMap[report.id] || '')}
              </div>
              <br clear="all" style="page-break-after:always; display:none;" />
            </div>
          ` : `
            <div style="text-align: center; page-break-after: always; display: flex; flex-direction: column; align-items: center; justify-content: space-between; min-height: 25cm; max-height: 277mm; box-sizing: border-box; padding: 30px 40px;">
              ${activeLogos.length > 0 ? `
                <div style="display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 32px; margin-bottom: 20px; width: 100%; flex-wrap: nowrap; overflow: hidden;">
                  ${activeLogos.map((l: string, idx: number) => {
                    const isKpmLogo = idx === 2 || l.toLowerCase().includes('kpm') || l.toLowerCase().includes('kementerian') || l.toLowerCase().includes('pendidikan');
                    const isYayasan = idx === 3 || l.toLowerCase().includes('yayasan') || l.toLowerCase().includes('sarawak');
                    const isCurtin = idx === 4 || l.toLowerCase().includes('curtin');
                    const userScale = report.logoScales?.[idx] || 1.0;
                    const h = Math.round((isCurtin ? 32 : (isKpmLogo ? 56 : (isYayasan ? 50 : 54))) * userScale);
                    const maxW = Math.round((isCurtin ? 120 : (isKpmLogo || isYayasan ? 78 : 75)) * userScale);
                    return `
                      <div style="display: inline-flex; align-items: center; justify-content: center; height: ${h}px; max-width: ${maxW}px; flex-shrink: 0;">
                        <img src="${l}" alt="Logo ${idx + 1}" style="height: ${h}px; max-height: ${h}px; width: auto; max-width: ${maxW}px; object-fit: contain; display: inline-block; vertical-align: middle;" />
                      </div>
                    `;
                  }).join('')}
                </div>
              ` : ''}
              <div style="font-family: Arial, sans-serif; text-align: center; margin-bottom: 20px; width: 100%;">
                <h1 style="font-size: 15pt; font-weight: bold; text-transform: uppercase; margin: 0; color: #111827;">ONE PAGE REPORT (OPR)</h1>
                <p style="font-size: 11pt; font-weight: bold; text-transform: uppercase; margin: 4px 0 0; color: #1e3a8a;">SEKOLAH KEBANGSAAN TUDAN, MIRI</p>
                <div style="height: 3px; width: 70px; background-color: #2563eb; margin: 8px auto 12px;"></div>
                <h2 style="font-size: 13pt; font-weight: bold; text-transform: uppercase; margin: 0; color: #111827;">${report.namaProgram || report.namaLaporan || ''}</h2>
              </div>
              <div style="width: 100%; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                ${report.gambarProgram && report.gambarProgram.length > 0 ? `<img src="${report.gambarProgram[0]}" style="width: 75%; max-height: 300px; object-fit: cover; border-radius: 6px; border: 1px solid #e5e7eb;" />` : `<div style="width: 75%; height: 160px; border: 2px dashed #d1d5db; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #9ca3af;">SEKOLAH KEBANGSAAN TUDAN, MIRI</div>`}
              </div>
              <div style="width: 85%; margin-top: 20px; border: 1.5px solid #1e3a8a; border-radius: 6px; padding: 14px 20px; text-align: left; background-color: #f8fafc;">
                <table style="width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.5;">
                  <tr>
                    <td style="width: 32%; font-weight: bold; color: #1e3a8a; padding: 3px 0; border: none;">Nama Program</td>
                    <td style="width: 4%; font-weight: bold; color: #1e3a8a; padding: 3px 0; border: none;">:</td>
                    <td style="width: 64%; font-weight: bold; text-transform: uppercase; padding: 3px 0; border: none;">${report.namaProgram || report.namaLaporan || '-'}</td>
                  </tr>
                  <tr>
                    <td style="font-weight: bold; color: #1e3a8a; padding: 3px 0; border: none;">Tarikh Pelaksanaan</td>
                    <td style="font-weight: bold; color: #1e3a8a; padding: 3px 0; border: none;">:</td>
                    <td style="padding: 3px 0; border: none;">${report.tarikhPelaksanaan || '-'}</td>
                  </tr>
                  <tr>
                    <td style="font-weight: bold; color: #1e3a8a; padding: 3px 0; border: none;">Tempat Pelaksanaan</td>
                    <td style="font-weight: bold; color: #1e3a8a; padding: 3px 0; border: none;">:</td>
                    <td style="padding: 3px 0; border: none;">${report.tempat || '-'}</td>
                  </tr>
                </table>
              </div>
              <div style="margin-top: 15px; display: flex; justify-content: center; width: 100%;">
                ${getCoverQrHtmlBadge(report.id, report.namaProgram || report.singkatanProgram || report.namaLaporan || '', qrMap[report.id] || '')}
              </div>
              <br clear="all" style="page-break-after:always; display:none;" />
            </div>
          `}
          <div style="position: relative;">
            <div style="position: relative; z-index: 10;">
              <div style="text-align: center; margin-top: 1in; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid #000;">
                <h2 style="font-size: 12pt; font-weight: bold; text-transform: uppercase; margin: 0; line-height: 1.15; font-family: Arial, sans-serif;">ONE PAGE REPORT (OPR)</h2>
                <p style="font-size: 10pt; font-weight: bold; text-transform: uppercase; margin: 2px 0 0; line-height: 1.15; font-family: Arial, sans-serif;">SEKOLAH KEBANGSAAN TUDAN, MIRI</p>
              </div>
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; table-layout: fixed; font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.15;">
                <thead>
                  <tr style="background-color: #f3f4f6;">
                    <th style="border: 1px solid black; padding: 4px; width: 5%; text-align: center;">BIL</th>
                    <th style="border: 1px solid black; padding: 4px; width: 20%; text-align: center;">PERKARA</th>
                    <th style="border: 1px solid black; padding: 4px; width: 75%; text-align: center;">MAKLUMAT</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style="break-inside: avoid; page-break-inside: avoid;">
                    <td style="border: 1px solid black; padding: 2px; text-align: center;">1</td>
                    <td style="border: 1px solid black; padding: 2px; font-weight: bold;">Nama Program</td>
                    <td style="border: 1px solid black; padding: 2px; text-transform: uppercase; font-weight: bold;">${report.namaProgram}</td>
                  </tr>
                  <tr style="break-inside: avoid; page-break-inside: avoid;">
                    <td style="border: 1px solid black; padding: 2px; text-align: center;">2</td>
                    <td style="border: 1px solid black; padding: 2px; font-weight: bold;">Tarikh / Masa</td>
                    <td style="border: 1px solid black; padding: 2px;">${report.tarikhPelaksanaan}</td>
                  </tr>
                  <tr style="break-inside: avoid; page-break-inside: avoid;">
                    <td style="border: 1px solid black; padding: 2px; text-align: center;">3</td>
                    <td style="border: 1px solid black; padding: 2px; font-weight: bold;">Sasaran</td>
                    <td style="border: 1px solid black; padding: 2px;">${report.sasaran}</td>
                  </tr>
                  <tr style="break-inside: avoid; page-break-inside: avoid;">
                    <td style="border: 1px solid black; padding: 2px; text-align: center;">4</td>
                    <td style="border: 1px solid black; padding: 2px; font-weight: bold;">Anjuran</td>
                    <td style="border: 1px solid black; padding: 2px;">${report.anjuran}</td>
                  </tr>
                  <tr style="break-inside: avoid; page-break-inside: avoid;">
                    <td style="border: 1px solid black; padding: 2px; text-align: center;">5</td>
                    <td style="border: 1px solid black; padding: 2px; font-weight: bold;">Objektif</td>
                    <td style="border: 1px solid black; padding: 2px; white-space: pre-wrap;">${report.objektif}</td>
                  </tr>
                  <tr style="break-inside: avoid; page-break-inside: avoid;">
                    <td style="border: 1px solid black; padding: 2px; text-align: center;">6</td>
                    <td style="border: 1px solid black; padding: 2px; font-weight: bold;">Kekuatan</td>
                    <td style="border: 1px solid black; padding: 2px; white-space: pre-wrap;">${report.kekuatan}</td>
                  </tr>
                  <tr style="break-inside: avoid; page-break-inside: avoid;">
                    <td style="border: 1px solid black; padding: 2px; text-align: center;">7</td>
                    <td style="border: 1px solid black; padding: 2px; font-weight: bold;">Perkara Perlu Penambahbaikan</td>
                    <td style="border: 1px solid black; padding: 2px; white-space: pre-wrap;">${report.perkaraPerluPenambahbaikan}</td>
                  </tr>
                  <tr style="break-inside: avoid; page-break-inside: avoid;">
                    <td style="border: 1px solid black; padding: 2px; text-align: center;">8</td>
                    <td style="border: 1px solid black; padding: 2px; font-weight: bold;">Cadangan Penambahbaikan</td>
                    <td style="border: 1px solid black; padding: 2px; white-space: pre-wrap;">${report.cadanganPenambahbaikan}</td>
                  </tr>
                  <tr style="break-inside: avoid; page-break-inside: avoid;">
                    <td style="border: 1px solid black; padding: 2px; text-align: center;">9</td>
                    <td style="border: 1px solid black; padding: 2px; font-weight: bold;">Gambar Pelaksanaan</td>
                    <td style="border: 1px solid black; padding: 2px; line-height: 1.0;">
                      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 2px;">
                        ${(report.gambarProgram || []).map((imgUrl: string, idx: number) => `
                          <div style="break-inside: avoid;">
                            <div style="height: 75px; background-color: #f3f4f6; border-radius: 4px; overflow: hidden; border: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: center; padding: 0;">
                              <img src="${imgUrl}" style="max-width: 100%; max-height: 100%; object-fit: contain;" />
                            </div>
                            ${report.peneranganGambar && report.peneranganGambar[idx] ? `<p style="text-align: center; font-size: 9pt; font-family: Arial, sans-serif; margin-top: 0px; margin-bottom: 0px; line-height: 1.0;">${report.peneranganGambar[idx]}</p>` : ''}
                          </div>
                        `).join('')}
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div style="display: flex; justify-content: space-between; margin-top: 20px; page-break-inside: avoid; font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.0;">
                <div style="width: 40%; text-align: left;">
                  <p style="margin: 0; margin-bottom: 0.8cm;">Disediakan oleh:</p>
                  <div style="border-top: 1px solid black; padding-top: 4px;">
                    <p style="margin: 0; font-weight: bold; text-transform: uppercase;">${report.disediakanOleh || ' '}</p>
                    <p style="margin: 0;">${report.jawatanDisediakanOleh || report.jawatanDisediakan || ' '}</p>
                  </div>
                </div>
                <div style="width: 40%; text-align: left;">
                  <p style="margin: 0; margin-bottom: 1.5cm;">Disahkan oleh:</p>
                  <div style="border-top: 1px solid black; padding-top: 4px;">
                    <p style="margin: 0; font-weight: bold; text-transform: uppercase;">${report.disahkanOleh || report.disemakOleh || ' '}</p>
                    <p style="margin: 0;">${report.jawatanDisahkanOleh || report.jawatanDisemak || ' '}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="back-cover-page-container" style="page-break-before: always; break-before: page; text-align: center; position: relative; width: 100%; height: 100%; min-height: 290mm; max-height: 297mm; overflow: hidden; margin: 0; padding: 0; box-sizing: border-box;">
            ${activeBackCover ? `
              <img src="${activeBackCover}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; display: block;" alt="Cover Belakang" />
              <div style="position: absolute; top: 50%; left: 0; right: 0; width: 100%; display: flex; align-items: center; justify-content: center; transform: translateY(-50%); pointer-events: none; z-index: 20;">
                ${getBackCoverQrHtmlBadge(report.id, report.namaProgram || report.singkatanProgram || report.namaLaporan || '', qrMap[report.id] || '')}
              </div>
            ` : `
              <div style="display: flex; flex-direction: column; align-items: center; justify-content: space-between; min-height: 290mm; box-sizing: border-box; padding: 40px 30px; font-family: Arial, sans-serif; background: linear-gradient(180deg, #f8fafc 0%, #ffffff 50%, #eff6ff 100%);">
                <div style="width: 100%; padding-top: 15px;">
                  <p style="font-size: 10pt; font-weight: bold; text-transform: uppercase; color: #666; margin: 0;">KEMENTERIAN PENDIDIKAN MALAYSIA</p>
                  <p style="font-size: 11pt; font-weight: bold; text-transform: uppercase; color: #333; margin: 4px 0 0;">JABATAN PENDIDIKAN NEGERI SARAWAK</p>
                  <p style="font-size: 10pt; text-transform: uppercase; color: #666; margin: 2px 0 20px;">PEJABAT PENDIDIKAN DAERAH MIRI</p>
                </div>

                <div style="margin: auto 0; padding: 20px 0;">
                  ${activeLogos.length > 0 ? `
                    <img src="${activeLogos[0]}" alt="Logo Sekolah" style="height: 85px; max-height: 85px; width: auto; max-width: 120px; object-fit: contain; margin-bottom: 15px;" />
                  ` : ''}
                  <h2 style="font-size: 15pt; font-weight: bold; text-transform: uppercase; margin: 5px 0 0; color: #111827;">SEKOLAH KEBANGSAAN TUDAN</h2>
                  <p style="font-size: 11pt; font-weight: bold; text-transform: uppercase; color: #1e3a8a; margin: 4px 0 20px;">MIRI, SARAWAK</p>
                  <div style="width: 70px; height: 3px; background-color: #2563eb; margin: 15px auto;"></div>
                  <div style="background-color: #f8fafc; border: 1.5px solid #1e3a8a; border-radius: 8px; padding: 15px 25px; max-width: 420px; margin: 0 auto; text-align: left;">
                    <p style="font-size: 9pt; font-weight: bold; text-transform: uppercase; color: #1e3a8a; margin: 0; text-align: center;">DOKUMEN DOKUMENTASI RASMI</p>
                    <p style="font-size: 11pt; font-weight: bold; text-transform: uppercase; color: #111827; margin: 4px 0 10px; text-align: center;">ONE PAGE REPORT (OPR)</p>
                    <p style="font-size: 10pt; margin: 4px 0; color: #333;"><strong>Program:</strong> <span style="text-transform: uppercase;">${report.namaProgram || report.namaLaporan || '-'}</span></p>
                    <p style="font-size: 10pt; margin: 4px 0; color: #333;"><strong>Tarikh:</strong> ${report.tarikhPelaksanaan || '-'}</p>
                    <p style="font-size: 10pt; margin: 4px 0; color: #333;"><strong>Tempat:</strong> ${report.tempat || '-'}</p>
                  </div>
                </div>

                <div style="width: 100%; border-top: 1px solid #e5e7eb; padding-top: 15px;">
                  <p style="font-size: 10pt; font-style: italic; color: #555; margin: 0;">"BERILMU • BERAKHLAK • BERJAYA"</p>
                  <p style="font-size: 8pt; text-transform: uppercase; color: #888; margin-top: 8px;">Shine Tudan Shine</p>
                </div>
              </div>
            `}
          </div>
        </div>
      `;
    }).join('\n');

    const styleTags = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map(tag => tag.outerHTML)
      .join('\n');

    const pageCss = `
      @page {
        size: A4 portrait;
        margin: 0 !important;
      }
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        background-color: white;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 11pt;
        margin: 0 !important;
        padding: 0 !important;
      }
      .cover-page-container, .back-cover-page-container {
        width: 100% !important;
        height: 100vh !important;
        min-height: 297mm !important;
        max-height: 297mm !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        box-shadow: none !important;
        page-break-after: always !important;
        break-after: page !important;
        box-sizing: border-box !important;
      }
      .report-container {
        page-break-after: always;
      }
      .report-table-content {
        padding: 8mm 12mm !important;
        box-sizing: border-box !important;
      }
      table { page-break-inside: auto; }
      tr    { page-break-inside: avoid; page-break-after: auto; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
    `;

    printWindow.document.write(`
      <html>
        <head>
          <title>Cetak Laporan Gabungan</title>
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
              }, 800);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
    toast.success('Sedia untuk dicetak', { id: toastId });
  };

  if (loading) {
    return <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>;
  }

  const filteredReports = reports.filter(report => {
    const searchLower = searchQuery.toLowerCase();
    const namaLaporan = (report.namaLaporan || '').toLowerCase();
    const namaProgram = (report.namaProgram || '').toLowerCase();
    const tarikhPelaksanaan = (report.tarikhPelaksanaan || '').toLowerCase();
    
    return namaLaporan.includes(searchLower) || 
           namaProgram.includes(searchLower) || 
           tarikhPelaksanaan.includes(searchLower);
  });

  const totalReportsCount = reports.length;
  
  const totalImagesCount = reports.reduce((acc, report) => {
    return acc + (report.gambarProgram ? report.gambarProgram.filter((url: string) => url && url.trim() !== '').length : 0);
  }, 0);

  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  
  const reportsThisMonthCount = reports.filter(report => {
    let date = null;
    if (report.createdAt?.toDate) {
      date = report.createdAt.toDate();
    } else if (report.createdAt) {
      date = new Date(report.createdAt);
    }
    if (date && !isNaN(date.getTime())) {
      return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
    }
    return false;
  }).length;

  return (
    <div>
      {(isOffline || isForcedOffline) && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6 rounded-md shadow-sm">
          <div className="flex">
            <div className="flex-shrink-0">
              <WifiOff className="h-5 w-5 text-yellow-400" aria-hidden="true" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-700">
                You are currently offline {isForcedOffline ? '(Forced)' : ''}. Working with cached data. Some features may not be available.
              </p>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-gray-900">Laporan Saya</h2>
          <button
            onClick={handleToggleOffline}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
              isForcedOffline
                ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                : 'bg-green-100 text-green-700 hover:bg-green-200'
            }`}
            title={isForcedOffline ? "Matikan mod luar talian (Online)" : "Paksakan mod luar talian (Force Offline)"}
          >
            {isForcedOffline ? <WifiOff size={14} /> : <Wifi size={14} />}
            {isForcedOffline ? "Forced Offline" : "Online"}
          </button>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-initial sm:w-64">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search size={18} className="text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Cari program atau tarikh..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 w-full border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm transition-shadow"
            />
          </div>
          {isSelectMode ? (
            <button
              onClick={() => {
                setIsSelectMode(false);
                setSelectedReports(new Set());
              }}
              className="flex items-center justify-center gap-2 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium shrink-0"
            >
              Batal Pilih
            </button>
          ) : (
            <button
              onClick={() => setIsSelectMode(true)}
              className="flex items-center justify-center gap-2 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium shrink-0"
              disabled={reports.length === 0}
            >
              <CheckSquare size={18} />
              <span className="hidden sm:inline">Pilih Laporan</span>
            </button>
          )}
          <button
            onClick={onCreate}
            className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shrink-0"
          >
            <Plus size={18} />
            <span className="hidden sm:inline">Laporan Baru</span>
          </button>
        </div>
      </div>

      {isSelectMode && selectedReports.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6 flex justify-between items-center animate-in fade-in slide-in-from-top-2 duration-300">
          <span className="text-blue-800 font-medium text-sm">
            {selectedReports.size} laporan dipilih
          </span>
          <button
            onClick={handleDownloadCombinedPdf}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors text-sm shadow-sm"
          >
            <Printer size={16} />
            Cetak Gabungan PDF
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <FileText size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Jumlah Laporan</p>
            <p className="text-2xl font-bold text-gray-900">{totalReportsCount}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-green-50 text-green-600 flex items-center justify-center shrink-0">
            <Calendar size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Bulan Ini</p>
            <p className="text-2xl font-bold text-gray-900">{reportsThisMonthCount}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Gambar Dimuat Naik</p>
            <p className="text-2xl font-bold text-gray-900">{totalImagesCount}</p>
          </div>
        </div>
      </div>

      <ReportActivityChart reports={reports} />

      {/* Pilihan Mod Paparan Dashboard: Galeri Muka Depan vs Paparan Dokumen OPR */}
      <div className="flex items-center justify-between border-b border-gray-200 pb-3 mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-1.5 bg-gray-100 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => {
              setDashboardViewMode('grid');
              localStorage.setItem('dashboardViewMode', 'grid');
            }}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              dashboardViewMode === 'grid'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <BookOpen size={15} />
            <span>Galeri Muka Depan OPR</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setDashboardViewMode('opr');
              localStorage.setItem('dashboardViewMode', 'opr');
            }}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              dashboardViewMode === 'opr'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <FileText size={15} />
            <span>Paparan Dokumen OPR (Penuh)</span>
          </button>
        </div>

        {dashboardViewMode === 'opr' && filteredReports.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={activeOprIndex <= 0}
              onClick={() => setActiveOprIndex(prev => Math.max(0, prev - 1))}
              className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              title="Laporan Sebelumnya"
            >
              <ChevronLeft size={16} />
            </button>
            <select
              value={activeOprIndex}
              onChange={(e) => setActiveOprIndex(Number(e.target.value))}
              className="bg-white border border-gray-300 text-gray-900 text-xs rounded-lg px-3 py-1.5 focus:ring-blue-500 focus:border-blue-500 font-medium max-w-[220px] truncate"
            >
              {filteredReports.map((r, i) => (
                <option key={r.id} value={i}>
                  {i + 1}. {r.namaProgram || r.namaLaporan || 'Tanpa Nama'} ({r.tarikhPelaksanaan || 'Tiada Tarikh'})
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={activeOprIndex >= filteredReports.length - 1}
              onClick={() => setActiveOprIndex(prev => Math.min(filteredReports.length - 1, prev + 1))}
              className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              title="Laporan Seterusnya"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {reports.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-8 text-center border border-gray-100">
          <div className="w-16 h-16 bg-gray-50 text-gray-400 rounded-full flex items-center justify-center mx-auto mb-4">
            <FileText size={32} />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-1">Tiada laporan</h3>
          <p className="text-gray-500 mb-6">Cipta One Page Report pertama anda untuk bermula.</p>
          <button
            onClick={onCreate}
            className="inline-flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-lg hover:bg-blue-100 transition-colors font-medium"
          >
            <Plus size={18} />
            Cipta Laporan
          </button>
        </div>
      ) : filteredReports.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-8 text-center border border-gray-100">
          <div className="w-16 h-16 bg-gray-50 text-gray-400 rounded-full flex items-center justify-center mx-auto mb-4">
            <Search size={32} />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-1">Tiada padanan ditemui</h3>
          <p className="text-gray-500">Cuba carian dengan kata kunci yang lain.</p>
        </div>
      ) : dashboardViewMode === 'opr' ? (
        /* Mod Paparan OPR Terus di Dashboard - Merangkumi Muka Depan & Jadual */
        (() => {
          const report = filteredReports[activeOprIndex] || filteredReports[0];
          if (!report) return null;
          const activeLogos: string[] = Array.isArray(report.logos) && report.logos.length > 0
            ? report.logos.filter((l: string) => l && l.trim() !== '')
            : (systemLogos.length > 0 ? systemLogos : (report.logoSekolah ? [report.logoSekolah] : []));

          return (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6 overflow-hidden">
              {/* Toolbar Atas OPR */}
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-gray-200 flex-wrap gap-2">
                <div>
                  <span className="text-xs font-bold text-blue-600 uppercase tracking-wide">Paparan Dokumen OPR Rasmi</span>
                  <h3 className="text-lg font-bold text-gray-900 leading-tight">
                    {report.namaProgram || report.namaLaporan || 'One Page Report'}
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onView(report.id)}
                    className="flex items-center gap-1.5 bg-blue-600 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors shadow-xs"
                    title="Buka Paparan Penuh & Cetak"
                  >
                    <ExternalLink size={14} />
                    <span>Paparan Penuh & Cetak</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(report.id)}
                    className="flex items-center gap-1.5 bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors"
                  >
                    <Edit2 size={14} />
                    <span>Sunting</span>
                  </button>
                </div>
              </div>

              {/* Sub-Navigasi Halaman Dokumen */}
              <div className="flex items-center justify-center gap-1.5 bg-gray-100 p-1 rounded-xl max-w-md mx-auto mb-6">
                <button
                  type="button"
                  onClick={() => setOprDocTab('all')}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                    oprDocTab === 'all'
                      ? 'bg-white text-blue-700 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Semua Halaman (Lengkap)
                </button>
                <button
                  type="button"
                  onClick={() => setOprDocTab('cover')}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                    oprDocTab === 'cover'
                      ? 'bg-white text-blue-700 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Muka Depan
                </button>
                <button
                  type="button"
                  onClick={() => setOprDocTab('table')}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                    oprDocTab === 'table'
                      ? 'bg-white text-blue-700 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Jadual OPR
                </button>
              </div>

              {/* 1. Muka Depan (Cover Page) OPR */}
              {(oprDocTab === 'all' || oprDocTab === 'cover') && (
                <div className="max-w-[210mm] mx-auto mb-8 border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white">
                  <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <BookOpen size={14} className="text-amber-400" />
                      Muka Depan (Cover Page) Rasmi
                    </span>
                    <span className="text-[10px] bg-slate-700 text-slate-200 px-2 py-0.5 rounded font-mono">
                      Halaman 1
                    </span>
                  </div>
                  <ReportCoverThumbnail 
                    report={report} 
                    coverTemplate={report.gambarMukaDepan || report.coverTemplate || coverTemplate} 
                    systemLogos={systemLogos}
                  />
                </div>
              )}

              {/* 2. Helaian OPR Rasmi (Jadual) */}
              {(oprDocTab === 'all' || oprDocTab === 'table') && (
                <div className="max-w-[210mm] mx-auto border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white mb-6">
                  <div className="bg-blue-900 text-white px-4 py-2 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <FileText size={14} className="text-blue-300" />
                      Dokumentasi Rasmi One Page Report (OPR)
                    </span>
                    <span className="text-[10px] bg-blue-800 text-blue-100 px-2 py-0.5 rounded font-mono">
                      Halaman 2
                    </span>
                  </div>

                  <div className="px-4 pb-4 sm:px-6 sm:pb-6" style={{ fontFamily: 'Arial, sans-serif', paddingTop: '1in' }}>
                    {/* Tajuk Rasmi OPR - Dinaikkan ke atas sepenuhnya */}
                    <div className="text-center mt-0 mb-2 border-b border-gray-200 pb-1.5">
                      <h2 className="text-base sm:text-lg font-bold uppercase tracking-wider text-black m-0" style={{ letterSpacing: '0.05em', lineHeight: 1.1 }}>
                        ONE PAGE REPORT (OPR)
                      </h2>
                      <p className="text-xs sm:text-sm font-semibold uppercase text-gray-700 m-0" style={{ lineHeight: 1.2 }}>
                        SEKOLAH KEBANGSAAN TUDAN, MIRI
                      </p>
                    </div>

                    {/* Jadual Rasmi OPR */}
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse border border-black mb-2" style={{ fontSize: '11pt', lineHeight: 1.15 }}>
                        <thead>
                          <tr>
                            <th className="border border-black p-0.5 bg-gray-100 font-bold text-center" style={{ width: '5%' }}>BIL</th>
                            <th className="border border-black p-0.5 bg-gray-100 font-bold text-center" style={{ width: '20%' }}>PERKARA</th>
                            <th className="border border-black p-0.5 bg-gray-100 font-bold text-center" style={{ width: '75%' }}>MAKLUMAT</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="border border-black p-0.5 text-center font-bold">1</td>
                            <td className="border border-black p-0.5 font-bold">Nama Program</td>
                            <td className="border border-black p-0.5 text-justify font-semibold">{report.namaProgram || report.namaLaporan || '-'}</td>
                          </tr>
                          <tr>
                            <td className="border border-black p-0.5 text-center font-bold">2</td>
                            <td className="border border-black p-0.5 font-bold">Tarikh Pelaksanaan</td>
                            <td className="border border-black p-0.5 text-justify">{report.tarikhPelaksanaan || '-'}</td>
                          </tr>
                          <tr>
                            <td className="border border-black p-0.5 text-center font-bold">3</td>
                            <td className="border border-black p-0.5 font-bold">Tempat</td>
                            <td className="border border-black p-0.5 text-justify">{report.tempat || '-'}</td>
                          </tr>
                          <tr>
                            <td className="border border-black p-0.5 text-center font-bold">4</td>
                            <td className="border border-black p-0.5 font-bold">Sasaran</td>
                            <td className="border border-black p-0.5 text-justify">{report.sasaran || '-'}</td>
                          </tr>
                          <tr>
                            <td className="border border-black p-0.5 text-center font-bold">5</td>
                            <td className="border border-black p-0.5 font-bold">Anjuran</td>
                            <td className="border border-black p-0.5 text-justify">{report.anjuran || '-'}</td>
                          </tr>
                          <tr>
                            <td className="border border-black p-0.5 text-center font-bold">6</td>
                            <td className="border border-black p-0.5 font-bold">Objektif</td>
                            <td className="border border-black p-0.5 whitespace-pre-wrap text-justify">{report.objektif || '-'}</td>
                          </tr>
                          <tr>
                            <td className="border border-black p-0.5 text-center font-bold">7</td>
                            <td className="border border-black p-0.5 font-bold">Kekuatan</td>
                            <td className="border border-black p-0.5 whitespace-pre-wrap text-justify">{report.kekuatan || '-'}</td>
                          </tr>
                          <tr>
                            <td className="border border-black p-0.5 text-center font-bold">8</td>
                            <td className="border border-black p-0.5 font-bold">Perkara Perlu Penambahbaikan</td>
                            <td className="border border-black p-0.5 whitespace-pre-wrap text-justify">{report.perkaraPerluPenambahbaikan || '-'}</td>
                          </tr>
                          <tr>
                            <td className="border border-black p-0.5 text-center font-bold">9</td>
                            <td className="border border-black p-0.5 font-bold">Cadangan Penambahbaikan</td>
                            <td className="border border-black p-0.5 whitespace-pre-wrap text-justify">{report.cadanganPenambahbaikan || '-'}</td>
                          </tr>
                          {report.penilaianKeberkesanan && (
                            <tr>
                              <td className="border border-black p-0.5 text-center font-bold">10</td>
                              <td className="border border-black p-0.5 font-bold">Penilaian Keberkesanan</td>
                              <td className="border border-black p-0.5 whitespace-pre-wrap text-justify">{report.penilaianKeberkesanan}</td>
                            </tr>
                          )}
                          <tr>
                            <td className="border border-black p-0.5 text-center font-bold">{report.penilaianKeberkesanan ? '11' : '10'}</td>
                            <td className="border border-black p-0.5 font-bold">Gambar Pelaksanaan</td>
                            <td className="border border-black p-0.5" style={{ lineHeight: 1.0 }}>
                              {report.gambarProgram && report.gambarProgram.length > 0 ? (
                                <div className="grid grid-cols-2 gap-2 mb-2">
                                  {report.gambarProgram.map((url: string, index: number) => (
                                    <div key={index} className="flex flex-col">
                                      <div className="h-[75px] w-full border border-dashed border-gray-400 overflow-hidden flex items-center justify-center">
                                        <img src={url} alt={`Gambar ${index + 1}`} className="max-w-full max-h-full object-contain" />
                                      </div>
                                      {report.peneranganGambar && report.peneranganGambar[index] && (
                                        <p className="text-[9pt] text-center italic mt-0.5" style={{ lineHeight: 1.0 }}>{report.peneranganGambar[index]}</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-gray-500 italic">Tiada gambar dimuat naik.</span>
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Tandatangan Pengesahan */}
                    <div className="flex justify-between mt-4 px-8" style={{ fontSize: '11pt', lineHeight: 1.0 }}>
                      <div className="text-left w-2/5">
                        <p style={{ marginBottom: '0.8cm' }}>Disediakan oleh:</p>
                        <div style={{ borderTop: '1px solid black', width: '100%', paddingTop: '4px' }}>
                          <p className="font-bold uppercase whitespace-nowrap m-0">{report.disediakanOleh || ' '}</p>
                          <p className="m-0">{report.jawatanDisediakanOleh || ' '}</p>
                        </div>
                      </div>
                      <div className="text-left w-2/5">
                        <p style={{ marginBottom: '0.8cm' }}>Disahkan oleh:</p>
                        <div style={{ borderTop: '1px solid black', width: '100%', paddingTop: '4px' }}>
                          <p className="font-bold uppercase whitespace-nowrap m-0">{report.disahkanOleh || ' '}</p>
                          <p className="m-0">{report.jawatanDisahkanOleh || ' '}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()
      ) : (
        /* Galeri Muka Depan OPR (Setiap Kad Memaparkan Muka Depan Rasmi Yang Kemas & Tersusun) */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filteredReports.map((report) => (
            <div 
              key={report.id}
              onClick={(e) => isSelectMode ? handleToggleSelect(report.id, e) : onView(report.id)}
              className={`bg-white rounded-xl shadow-sm border flex flex-col hover:shadow-lg transition-all cursor-pointer group overflow-hidden ${
                isSelectMode && selectedReports.has(report.id) ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:border-blue-300'
              }`}
            >
              {/* Paparan Muka Depan OPR (Official Cover Page Card) */}
              <div className="w-full relative overflow-hidden bg-slate-50 border-b border-gray-100 group/thumb">
                <ReportCoverThumbnail 
                  report={report} 
                  coverTemplate={report.gambarMukaDepan || report.coverTemplate || coverTemplate} 
                  systemLogos={systemLogos}
                />
                
                {/* Checkbox for Select Mode */}
                {isSelectMode && (
                  <div className="absolute top-2 right-2 z-20 bg-white/95 backdrop-blur-xs rounded-md shadow-sm p-1">
                    {selectedReports.has(report.id) ? (
                      <CheckSquare className="text-blue-600" size={20} />
                    ) : (
                      <Square className="text-gray-400" size={20} />
                    )}
                  </div>
                )}

                {/* Hover Quick Overlay */}
                <div className="absolute inset-0 bg-blue-950/25 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center pointer-events-none p-2 text-center">
                  <span className="bg-white/95 backdrop-blur-xs text-blue-900 font-bold text-xs px-3.5 py-2 rounded-xl shadow-lg flex items-center gap-1.5 transform translate-y-2 group-hover/thumb:translate-y-0 transition-transform">
                    <Eye size={15} className="text-blue-600 shrink-0" />
                    <span>Buka Paparan OPR</span>
                  </span>
                </div>
              </div>

              {/* Bahagian Maklumat Terperinci Di Bawah Muka Depan (Nama Program Terpapar Jelas & Tersusun) */}
              <div className="p-4 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                      OPR SK Tudan
                    </span>
                  </div>
                  
                  <h3 className="text-base font-extrabold text-slate-900 leading-snug line-clamp-2 mb-2.5 group-hover:text-blue-600 transition-colors tracking-tight" title={report.namaProgram || report.namaLaporan}>
                    {report.namaProgram || report.namaLaporan || 'Tanpa Tajuk'}
                  </h3>

                  <div className="space-y-1.5 text-xs text-gray-600 mb-3 bg-slate-50/80 p-2 rounded-lg border border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <Calendar size={13} className="text-blue-600 shrink-0" />
                      <span className="truncate font-medium">{report.tarikhPelaksanaan || 'Tiada Tarikh'}</span>
                    </div>
                    {report.tempat && (
                      <div className="flex items-center gap-1.5">
                        <MapPin size={13} className="text-rose-500 shrink-0" />
                        <span className="truncate font-medium">{report.tempat}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-3 mt-2">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 truncate max-w-[65%]">
                      <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-[10px] shrink-0">
                        {(report.disediakanOleh || 'G').charAt(0).toUpperCase()}
                      </div>
                      <span className="truncate">{report.disediakanOleh || 'Warga SK Tudan'}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onEdit(report.id); }}
                        className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                        title="Sunting Laporan"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setReportToDelete(report.id); }}
                        className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                        title="Padam Laporan"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onView(report.id);
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs"
                    title="Buka Paparan OPR Lengkap"
                  >
                    <Eye size={14} />
                    <span>Buka Paparan OPR</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {reportToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Padam Laporan</h3>
            <p className="text-gray-500 mb-6">Adakah anda pasti mahu memadam laporan ini? Tindakan ini tidak boleh dipulihkan.</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setReportToDelete(null)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors font-medium"
              >
                Batal
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-lg transition-colors font-medium"
              >
                Padam
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
