import React, { useState, useEffect, useRef } from 'react';
import { doc, getDoc, setDoc, getDocFromCache } from 'firebase/firestore';
import { db } from '../firebase';
import { ArrowLeft, Save, Upload, Loader2, Plus, Trash2, FileText, Image as ImageIcon, Users, Folder, ChevronLeft, ChevronRight, Eye, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

interface AdminSettingsProps {
  onBack: () => void;
}

export interface Teacher {
  nama: string;
  jawatan: string;
}

const AdminSettings: React.FC<AdminSettingsProps> = ({ onBack }) => {
  const [logos, setLogos] = useState<string[]>(['', '', '', '', '', '']);
  const [logoUrl, setLogoUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [backCoverUrl, setBackCoverUrl] = useState('');
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [driveRootFolder, setDriveRootFolder] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [activeUploadingSlot, setActiveUploadingSlot] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'logo' | 'guru' | 'cover' | 'drive'>('logo');
  const slotInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const backCoverInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      const docRef = doc(db, 'settings', 'global');
      try {
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          const fetchedLogos: string[] = Array.isArray(data.logos) && data.logos.length > 0
            ? [...data.logos, '', '', '', '', ''].slice(0, 6)
            : (data.logoSekolah ? [data.logoSekolah, '', '', '', '', ''] : ['', '', '', '', '', '']);
          setLogos(fetchedLogos);
          setLogoUrl(fetchedLogos.find(l => l && l.trim() !== '') || data.logoSekolah || '');
          setCoverUrl(data.coverTemplate || '');
          setBackCoverUrl(data.backCoverTemplate || '');
          setTeachers(data.senaraiGuru || []);
          setDriveRootFolder(data.driveRootFolder || '');
        }
      } catch (error: any) {
        if (error?.code === 'unavailable' || (error?.message && error.message.toLowerCase().includes('offline'))) {
          console.warn("Client is offline, attempting to read settings from cache...");
          try {
            const cachedSnap = await getDocFromCache(docRef);
            if (cachedSnap.exists()) {
              const data = cachedSnap.data() as any;
              const fetchedLogos: string[] = Array.isArray(data.logos) && data.logos.length > 0
                ? [...data.logos, '', '', '', '', ''].slice(0, 6)
                : (data.logoSekolah ? [data.logoSekolah, '', '', '', '', ''] : ['', '', '', '', '', '']);
              setLogos(fetchedLogos);
              setLogoUrl(fetchedLogos.find(l => l && l.trim() !== '') || data.logoSekolah || '');
              setCoverUrl(data.coverTemplate || '');
              setBackCoverUrl(data.backCoverTemplate || '');
              setTeachers(data.senaraiGuru || []);
              setDriveRootFolder(data.driveRootFolder || '');
            }
          } catch (cacheError) {
             console.log("No valid cache available.");
          }
        } else {
          console.error("Error fetching settings:", error);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const toastId = toast.loading('Menyimpan tetapan...');
    try {
      const finalCoverUrl = coverUrl;
      const finalBackCoverUrl = backCoverUrl;
      const primaryLogo = logos.find(l => l && l.trim() !== '') || '';

      await setDoc(doc(db, 'settings', 'global'), {
        logos: logos,
        logoSekolah: primaryLogo,
        coverTemplate: finalCoverUrl,
        backCoverTemplate: finalBackCoverUrl,
        senaraiGuru: teachers,
        driveRootFolder: driveRootFolder
      }, { merge: true });

      localStorage.setItem('defaultLogos', JSON.stringify(logos));
      localStorage.setItem('cachedSystemLogos', JSON.stringify(logos));
      localStorage.setItem('defaultSchoolLogo', primaryLogo);
      if (finalCoverUrl) localStorage.setItem('cachedCoverTemplate', finalCoverUrl);
      if (finalBackCoverUrl) localStorage.setItem('cachedBackCoverTemplate', finalBackCoverUrl);
      toast.success('Tetapan berjaya disimpan.', { id: toastId });
    } catch (error) {
      console.error("Error saving settings:", error);
      toast.error('Gagal menyimpan tetapan.', { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const handleSlotLogoUpload = (slotIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'image/jpeg' && file.type !== 'image/png' && file.type !== 'image/webp') {
      toast.error('Sila pilih fail imej JPG, PNG atau WEBP.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Saiz gambar terlalu besar. Maksimum 5MB dibenarkan.');
      return;
    }

    setActiveUploadingSlot(slotIndex);
    const toastId = toast.loading(`Memproses Logo ${slotIndex + 1}...`);
    const reader = new FileReader();

    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        const MAX_WIDTH = 240;
        const MAX_HEIGHT = 240;
        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = Math.round(width);
        canvas.height = Math.round(height);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          let compressedDataUrl = '';
          try {
            const webp = canvas.toDataURL('image/webp', 0.85);
            if (webp && webp.startsWith('data:image/webp')) {
              compressedDataUrl = webp;
            }
          } catch (e) {}
          if (!compressedDataUrl) {
            compressedDataUrl = canvas.toDataURL('image/png');
          }
          
          setLogos(prev => {
            const next = [...prev];
            next[slotIndex] = compressedDataUrl;
            return next;
          });
          
          toast.success(`Logo ${slotIndex + 1} berjaya dimuat naik (klik Simpan untuk kekalkan).`, { id: toastId });
        } else {
          toast.error('Gagal memproses gambar.', { id: toastId });
        }
        setActiveUploadingSlot(null);
      };
      img.onerror = () => {
        toast.error('Gagal memuat gambar.', { id: toastId });
        setActiveUploadingSlot(null);
      };
      img.src = event.target?.result as string;
    };
    reader.onerror = () => {
      toast.error('Gagal membaca fail gambar.', { id: toastId });
      setActiveUploadingSlot(null);
    };

    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRemoveSlotLogo = (slotIndex: number) => {
    setLogos(prev => {
      const next = [...prev];
      next[slotIndex] = '';
      return next;
    });
    toast.success(`Logo ${slotIndex + 1} dipadamkan.`);
  };

  const handleMoveLogo = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= 6) return;
    setLogos(prev => {
      const next = [...prev];
      const temp = next[fromIndex];
      next[fromIndex] = next[toIndex];
      next[toIndex] = temp;
      return next;
    });
  };

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
      toast.error('Sila pilih gambar berformat JPG atau PNG sahaja.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      toast.error('Saiz gambar terlalu besar. Maksimum 5MB dibenarkan.');
      return;
    }

    const toastId = toast.loading('Memproses cover page...');
    const reader = new FileReader();

    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Resize if too large
        const MAX_WIDTH = 1200; // Better width for printing clarity
        const MAX_HEIGHT = 1697; // Better height for A4 aspect ratio
        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8) || canvas.toDataURL('image/png');
          setCoverUrl(compressedDataUrl);
          toast.success('Cover page berjaya diproses (klik Simpan untuk kekalkan).', { id: toastId });
        } else {
          toast.error('Gagal memproses gambar.', { id: toastId });
        }
      };
      img.src = event.target?.result as string;
    };
    reader.onerror = () => {
      toast.error('Gagal membaca fail gambar.', { id: toastId });
    };

    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleBackCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
      toast.error('Sila pilih gambar berformat JPG atau PNG sahaja.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Saiz gambar terlalu besar. Maksimum 5MB dibenarkan.');
      return;
    }

    const toastId = toast.loading('Memproses templat muka belakang...');
    const reader = new FileReader();

    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 1697;
        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8) || canvas.toDataURL('image/png');
          setBackCoverUrl(compressedDataUrl);
          toast.success('Templat muka belakang berjaya diproses (klik Simpan untuk kekalkan).', { id: toastId });
        } else {
          toast.error('Gagal memproses gambar.', { id: toastId });
        }
      };
      img.src = event.target?.result as string;
    };
    reader.onerror = () => {
      toast.error('Gagal membaca fail gambar.', { id: toastId });
    };

    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'text/csv' && !file.name.toLowerCase().endsWith('.csv')) {
      toast.error('Sila pilih fail berformat CSV sahaja.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split(/\r?\n/);
      const newTeachers: Teacher[] = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Skip header
        if (i === 0 && line.toLowerCase().includes('nama') && line.toLowerCase().includes('jawatan')) {
          continue;
        }

        const parts = line.split(',');
        const nama = parts[0]?.replace(/^"|"$/g, '').trim() || '';
        const jawatan = parts[1]?.replace(/^"|"$/g, '').trim() || '';

        if (nama) {
          newTeachers.push({ nama, jawatan });
        }
      }

      if (newTeachers.length > 0) {
        setTeachers([...teachers, ...newTeachers]);
        toast.success(`${newTeachers.length} guru berjaya diimport daripada CSV.`);
      } else {
        toast.error('Gagal menjumpai data guru dalam fail CSV.');
      }
    };
    reader.onerror = () => {
      toast.error('Gagal membaca fail CSV.');
    };

    reader.readAsText(file);
    e.target.value = '';
  };

  const addTeacher = () => {
    setTeachers([...teachers, { nama: '', jawatan: '' }]);
  };

  const removeTeacher = (index: number) => {
    const newTeachers = [...teachers];
    newTeachers.splice(index, 1);
    setTeachers(newTeachers);
  };

  const updateTeacher = (index: number, field: keyof Teacher, value: string) => {
    const newTeachers = [...teachers];
    newTeachers[index][field] = value;
    setTeachers(newTeachers);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 sm:px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack}
            className="p-1 sm:p-2 bg-white/20 hover:bg-white/30 rounded-full text-white transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <h2 className="text-lg sm:text-xl font-semibold text-white">Tetapan Admin Utama</h2>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-white text-blue-600 hover:bg-blue-50 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg font-medium transition-colors disabled:opacity-70 text-sm sm:text-base"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          <span className="hidden sm:inline">{saving ? 'Menyimpan...' : 'Simpan Tetapan'}</span>
        </button>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex -mb-px px-4 sm:px-6" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('logo')}
            className={`border-b-2 py-4 px-4 text-sm font-medium flex items-center gap-2 transition-colors ${
              activeTab === 'logo'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            <ImageIcon size={18} />
            Tetapan Logo OPR (Logo 1 - 6)
          </button>
          <button
            onClick={() => setActiveTab('cover')}
            className={`border-b-2 py-4 px-4 text-sm font-medium flex items-center gap-2 transition-colors ${
              activeTab === 'cover'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            <ImageIcon size={18} />
            Muat Naik Cover
          </button>
          <button
            onClick={() => setActiveTab('guru')}
            className={`border-b-2 py-4 px-4 text-sm font-medium flex items-center gap-2 transition-colors ${
              activeTab === 'guru'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            <Users size={18} />
            Senarai Nama Guru
          </button>
          <button
            onClick={() => setActiveTab('drive')}
            className={`border-b-2 py-4 px-4 text-sm font-medium flex items-center gap-2 transition-colors ${
              activeTab === 'drive'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            <Folder size={18} />
            Google Drive
          </button>
        </nav>
      </div>

      <div className="p-4 sm:p-6 min-h-[400px]">
        {/* Logo Section - 6 Slots */}
        {activeTab === 'logo' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
            <div className="border-b pb-3">
              <h3 className="text-lg font-bold text-gray-900">Tetapan Susunan Logo OPR (Logo 1 - Logo 6)</h3>
              <p className="text-sm text-gray-500 mt-1">
                Muat naik logo mengikut kedudukan rasmi yang betul (Logo 1 hingga Logo 6). Kesemua logo ini akan diekstrak secara automatik ke dalam borang laporan baharu dan dipaparkan dalam fail PDF OPR dengan <strong>saiz seragam bersebelahan dalam satu lorong</strong>.
              </p>
            </div>

            {/* 6 Logo Slots Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {[
                { slot: 0, title: 'Logo 1', desc: 'Jata Negara / KPM' },
                { slot: 1, title: 'Logo 2', desc: 'JPN (Negeri)' },
                { slot: 2, title: 'Logo 3', desc: 'PPD (Daerah)' },
                { slot: 3, title: 'Logo 4', desc: 'Sekolah / Agensi' },
                { slot: 4, title: 'Logo 5', desc: 'TS25 / Program Khas' },
                { slot: 5, title: 'Logo 6', desc: 'PIBG / Rakan Strategik' },
              ].map(({ slot, title, desc }) => {
                const currentLogo = logos[slot];
                const isUploading = activeUploadingSlot === slot;

                return (
                  <div key={slot} className="bg-white border-2 border-gray-200 hover:border-blue-300 rounded-xl p-3 flex flex-col items-center justify-between text-center transition-all shadow-xs relative group">
                    {/* Slot Header Badge */}
                    <div className="w-full flex items-center justify-between mb-2">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                        {title}
                      </span>
                      
                      {/* Move Left / Right Reorder */}
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleMoveLogo(slot, slot - 1)}
                          disabled={slot === 0}
                          title="Alih ke Kiri"
                          className="p-1 text-gray-400 hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 rounded-sm hover:bg-gray-100"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveLogo(slot, slot + 1)}
                          disabled={slot === 5}
                          title="Alih ke Kanan"
                          className="p-1 text-gray-400 hover:text-blue-600 disabled:opacity-20 disabled:hover:text-gray-400 rounded-sm hover:bg-gray-100"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Logo Preview Box */}
                    <div className="w-full h-28 border border-dashed border-gray-300 rounded-lg flex items-center justify-center relative overflow-hidden bg-gray-50 mb-2">
                      {currentLogo ? (
                        <img 
                          src={currentLogo} 
                          alt={title} 
                          className="w-full h-full object-contain p-2" 
                        />
                      ) : (
                        <div className="text-gray-400 flex flex-col items-center justify-center p-2">
                          <Upload size={20} className="mb-1 opacity-40" />
                          <span className="text-[11px] text-gray-400">Kosong</span>
                        </div>
                      )}

                      {isUploading && (
                        <div className="absolute inset-0 bg-white/90 flex items-center justify-center flex-col">
                          <Loader2 size={24} className="animate-spin text-blue-600 mb-1" />
                          <span className="text-[10px] font-semibold text-blue-600">Memproses...</span>
                        </div>
                      )}
                    </div>

                    {/* Position Description */}
                    <p className="text-[11px] text-gray-500 line-clamp-1 mb-2.5 font-medium" title={desc}>
                      {desc}
                    </p>

                    {/* Action Buttons */}
                    <div className="w-full flex items-center gap-1.5 mt-auto">
                      <input 
                        type="file" 
                        ref={el => slotInputRefs.current[slot] = el}
                        className="hidden" 
                        accept="image/jpeg,image/png,image/webp" 
                        onChange={(e) => handleSlotLogoUpload(slot, e)}
                      />
                      <button 
                        type="button"
                        onClick={() => slotInputRefs.current[slot]?.click()}
                        disabled={isUploading}
                        className="flex-1 bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs py-1.5 px-2 rounded-md font-medium transition-colors flex items-center justify-center gap-1"
                      >
                        <Upload size={12} />
                        {currentLogo ? 'Tukar' : 'Muat Naik'}
                      </button>
                      {currentLogo && (
                        <button 
                          type="button"
                          onClick={() => handleRemoveSlotLogo(slot)}
                          disabled={isUploading}
                          title="Padam slot ini"
                          className="text-red-600 bg-red-50 hover:bg-red-100 p-1.5 rounded-md transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Live Preview Lane - "Lorong Logo Sama Saiz Bersebelahan" */}
            <div className="border border-blue-200 bg-gradient-to-r from-blue-50/50 via-white to-blue-50/50 rounded-xl p-4 sm:p-5 mt-6 shadow-xs">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3 border-b border-blue-100 pb-2">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-blue-600 text-white rounded-lg">
                    <Eye size={16} />
                  </span>
                  <div>
                    <h4 className="text-sm font-bold text-gray-900">
                      Pratonton Lorong Logo OPR (Ekstrak Auto dalam PDF)
                    </h4>
                    <p className="text-xs text-gray-500">
                      Paparan sebenar susunan logo di bahagian atas OPR yang dijana:
                    </p>
                  </div>
                </div>
                <span className="text-xs text-blue-700 font-semibold bg-blue-100/70 px-2.5 py-1 rounded-full">
                  {logos.filter(l => l && l.trim() !== '').length} Logo Aktif
                </span>
              </div>

              {/* Simulated OPR Header Lane */}
              <div className="bg-white border border-gray-300 rounded-lg p-4 min-h-[90px] flex items-center justify-center shadow-inner overflow-x-auto">
                {logos.filter(l => l && l.trim() !== '').length > 0 ? (
                  <div className="flex flex-row items-center justify-center gap-4 sm:gap-6 flex-wrap w-full py-1">
                    {logos.map((logo, idx) => {
                      if (!logo || logo.trim() === '') return null;
                      return (
                        <div key={idx} className="flex flex-col items-center">
                          <img 
                            src={logo} 
                            alt={`Logo ${idx + 1}`} 
                            className="object-contain inline-block transition-all"
                            style={{ 
                              height: '70px', 
                              maxHeight: '70px', 
                              width: 'auto', 
                              maxWidth: '170px',
                              imageRendering: '-webkit-optimize-contrast',
                              verticalAlign: 'middle'
                            }}
                          />
                          <span className="text-[10px] text-gray-400 mt-1">Logo {idx + 1}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-4 text-gray-400 text-xs">
                    <ImageIcon size={24} className="mx-auto mb-1 opacity-30" />
                    Belum ada logo dimuat naik. Muat naik sekurang-kurangnya satu logo di atas.
                  </div>
                )}
              </div>
              <p className="text-[11px] text-gray-500 mt-2 text-center">
                * Nota: Semua logo dijajarkan bersebelahan pada ketinggian yang seragam (55px) secara automatik di kepala surat OPR PDF.
              </p>
            </div>
          </div>
        )}

        {/* Cover Page Section */}
        {activeTab === 'cover' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h3 className="text-lg font-medium text-gray-900 mb-4 border-b pb-2">Templat Muka Hadapan (Cover Page)</h3>
            <div className="flex flex-col sm:flex-row gap-6 items-start">
              <div className="w-48 h-64 border-2 border-dashed border-gray-300 rounded-xl flex items-center justify-center relative overflow-hidden bg-gray-50 flex-shrink-0 group">
                {coverUrl ? (
                  <img src={coverUrl} alt="Cover Page" className="w-full h-full object-contain p-2" />
                ) : (
                  <div className="text-gray-400 text-center p-4">
                    <Upload size={24} className="mx-auto mb-2 opacity-50" />
                    <span className="text-xs">Tiada Cover</span>
                  </div>
                )}
                {uploadProgress !== null && (
                  <div className="absolute inset-0 bg-white/80 flex items-center justify-center flex-col">
                    <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-2"></div>
                    <span className="text-xs font-bold text-blue-600">{uploadProgress}%</span>
                  </div>
                )}
              </div>
              
              <div className="flex-1 space-y-4">
                <p className="text-sm text-gray-500">
                  Templat muka hadapan ini akan digunakan untuk cetakan PDF. Maklumat seperti Nama Program, Tarikh dan Tempat akan diletakkan di atas gambar ini.
                </p>
                
                <div className="flex flex-wrap gap-2">
                  <input 
                    type="file" 
                    ref={coverInputRef} 
                    className="hidden" 
                    accept="image/jpeg,image/png" 
                    onChange={handleCoverUpload}
                  />
                  <button 
                    onClick={() => coverInputRef.current?.click()}
                    disabled={uploadProgress !== null}
                    className="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors flex items-center gap-2"
                  >
                    <Upload size={18} />
                    {coverUrl ? 'Tukar Cover' : 'Muat Naik Cover'}
                  </button>
                  {coverUrl && (
                    <button 
                      onClick={() => setCoverUrl('')}
                      disabled={uploadProgress !== null}
                      className="text-red-600 bg-red-50 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors flex items-center gap-2"
                    >
                      <Trash2 size={18} />
                      Padam Cover
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Templat Muka Belakang (Back Cover) */}
            <h3 className="text-lg font-medium text-gray-900 mt-8 mb-4 border-b pb-2">Templat Muka Belakang (Back Cover Page)</h3>
            <div className="flex flex-col sm:flex-row gap-6 items-start">
              <div className="w-48 h-64 border-2 border-dashed border-gray-300 rounded-xl flex items-center justify-center relative overflow-hidden bg-gray-50 flex-shrink-0 group">
                {backCoverUrl ? (
                  <img src={backCoverUrl} alt="Back Cover Page" className="w-full h-full object-contain p-2" />
                ) : (
                  <div className="text-gray-400 text-center p-4">
                    <Upload size={24} className="mx-auto mb-2 opacity-50" />
                    <span className="text-xs">Tiada Cover Belakang</span>
                  </div>
                )}
              </div>
              
              <div className="flex-1 space-y-4">
                <p className="text-sm text-gray-500">
                  Templat muka belakang ini akan diletakkan di halaman terakhir setiap laporan OPR untuk menghasilkan satu set dokumentasi program yang lengkap (Cover Depan + OPR + Cover Belakang).
                </p>
                
                <div className="flex flex-wrap gap-2">
                  <input 
                    type="file" 
                    ref={backCoverInputRef} 
                    className="hidden" 
                    accept="image/jpeg,image/png" 
                    onChange={handleBackCoverUpload}
                  />
                  <button 
                    onClick={() => backCoverInputRef.current?.click()}
                    className="bg-purple-50 text-purple-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-100 transition-colors flex items-center gap-2"
                  >
                    <Upload size={18} />
                    {backCoverUrl ? 'Tukar Cover Belakang' : 'Muat Naik Cover Belakang'}
                  </button>
                  {backCoverUrl && (
                    <button 
                      onClick={() => setBackCoverUrl('')}
                      className="text-red-600 bg-red-50 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors flex items-center gap-2"
                    >
                      <Trash2 size={18} />
                      Padam Cover Belakang
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Teachers Section */}
        {activeTab === 'guru' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 border-b pb-4 gap-4">
              <div>
                <h3 className="text-lg font-medium text-gray-900">Senarai Nama Guru & Jawatan</h3>
                <p className="text-sm text-gray-500">
                  Guru-guru boleh memilih nama dari senarai ini ketika mengisi ruangan "Disediakan Oleh" dan "Disahkan Oleh".
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input 
                  type="file" 
                  ref={csvInputRef} 
                  className="hidden" 
                  accept=".csv,text/csv" 
                  onChange={handleCsvUpload}
                />
                <button
                  onClick={() => csvInputRef.current?.click()}
                  className="flex items-center gap-1 sm:gap-2 bg-green-50 text-green-600 hover:bg-green-100 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg font-medium transition-colors text-sm"
                >
                  <FileText size={16} />
                  <span className="hidden sm:inline">Muat Naik CSV</span>
                </button>
                <button
                  onClick={addTeacher}
                  className="flex items-center gap-1 sm:gap-2 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg font-medium transition-colors text-sm"
                >
                  <Plus size={16} />
                  <span className="hidden sm:inline">Tambah Guru</span>
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {teachers.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-xl border border-gray-100">
                  <FileText size={32} className="mx-auto text-gray-400 mb-3" />
                  <h4 className="text-base font-medium text-gray-900 mb-1">Tiada Senarai Guru</h4>
                  <p className="text-gray-500 text-sm mb-4">Anda belum memasukkan senarai nama guru.</p>
                  <div className="flex items-center justify-center gap-3">
                    <button
                      onClick={addTeacher}
                      className="text-sm text-indigo-600 bg-indigo-50 px-4 py-2 rounded-lg hover:bg-indigo-100 transition-colors font-medium"
                    >
                      Tambah Manual
                    </button>
                    <span className="text-sm text-gray-400">atau</span>
                    <button
                      onClick={() => csvInputRef.current?.click()}
                      className="text-sm text-green-600 bg-green-50 px-4 py-2 rounded-lg hover:bg-green-100 transition-colors font-medium"
                    >
                      Muat Naik CSV
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {teachers.map((teacher, index) => (
                    <div key={index} className="flex flex-col gap-2 bg-gray-50 p-4 rounded-xl border border-gray-200 hover:border-blue-200 transition-colors group relative">
                      <button
                        onClick={() => removeTeacher(index)}
                        className="absolute right-2 top-2 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                        title="Padam"
                      >
                        <Trash2 size={16} />
                      </button>
                      <div className="space-y-2 mt-2">
                        <div>
                          <label className="text-xs font-medium text-gray-500 mb-1 w-full flex">Nama</label>
                          <input
                            type="text"
                            value={teacher.nama}
                            onChange={(e) => updateTeacher(index, 'nama', e.target.value)}
                            placeholder="Contoh: Ahmad bin Abu"
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 border-transparent bg-white shadow-sm outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-500 mb-1 w-full flex">Jawatan</label>
                          <input
                            type="text"
                            value={teacher.jawatan}
                            onChange={(e) => updateTeacher(index, 'jawatan', e.target.value)}
                            placeholder="Contoh: Guru Besar"
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 border-transparent bg-white shadow-sm outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Google Drive Section */}
        {activeTab === 'drive' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h3 className="text-lg font-medium text-gray-900 mb-4 border-b pb-2">Tetapan Google Drive</h3>
            <div className="space-y-4 max-w-2xl">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Google Drive Root Folder ID
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={driveRootFolder}
                    onChange={(e) => setDriveRootFolder(e.target.value)}
                    placeholder="Contoh: 1BxiMVs0XRX5RO..."
                    className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 border-transparent bg-white shadow-sm outline-none"
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Masukkan ID folder Google Drive yang akan dijadikan sebagai folder utama untuk penyimpanan dan pengurusan fail berpusat. URL folder biasanya kelihatan seperti ini: <code>https://drive.google.com/drive/folders/<b>ID_FOLDER_MAKA_SINI</b></code>.
                  Pastikan folder ini mempunyai akses perkongsian yang dibenarkan untuk diakses.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminSettings;
