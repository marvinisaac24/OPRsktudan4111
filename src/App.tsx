/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider } from 'firebase/auth';
import { collection, query, limit, onSnapshot, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, googleProvider, db } from './firebase';
import Dashboard from './components/Dashboard';
import ReportForm from './components/ReportForm';
import ReportDetail from './components/ReportDetail';
import OprPdfViewer from './components/OprPdfViewer';
import AdminSettings from './components/AdminSettings';
import { getGoogleAccessToken } from './services/driveService';
import { LogIn, LogOut, FileText, Cloud, Settings, Plus, LayoutDashboard, Eye, ShieldCheck, UserCheck } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';

export type ViewState = 'dashboard' | 'create' | 'edit' | 'view' | 'pdf' | 'admin';

const DEFAULT_GUEST_USER = {
  displayName: 'Warga SK Tudan',
  email: 'guru@sktudan.edu.my',
  photoURL: '',
  role: 'guru',
  isGuest: true,
};

export default function App() {
  const [user, setUser] = useState<any>(DEFAULT_GUEST_USER);
  const [loading, setLoading] = useState(false);
  const [currentView, setCurrentView] = useState<ViewState>('dashboard');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [latestReportId, setLatestReportId] = useState<string | null>(null);
  const [hasDriveAccess, setHasDriveAccess] = useState<boolean>(false);

  // Handle direct link / QR code scan (e.g. ?reportId=... or ?opr=...&program=...&format=pdf)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleUrlNavigation = () => {
        const params = new URLSearchParams(window.location.search);
        const reportIdFromUrl = params.get('reportId') || params.get('opr') || params.get('id');
        const formatFromUrl = params.get('format') || params.get('view');
        if (reportIdFromUrl) {
          setSelectedReportId(reportIdFromUrl);
          // If URL came from QR Code scan or explicit format=pdf, open OprPdfViewer directly!
          if (formatFromUrl === 'pdf' || params.has('format') || params.get('pdf') === '1') {
            setCurrentView('pdf');
          } else {
            setCurrentView('view');
          }
        }
      };

      handleUrlNavigation();
      window.addEventListener('popstate', handleUrlNavigation);
      return () => {
        window.removeEventListener('popstate', handleUrlNavigation);
      };
    }
  }, []);

  // Sync URL when switching between views
  const navigateToView = (view: ViewState, repId: string | null = null, progName: string = '') => {
    setCurrentView(view);
    setSelectedReportId(repId);
    if (typeof window !== 'undefined') {
      const slug = progName ? progName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) : 'laporan';
      if (view === 'pdf' && repId) {
        const newUrl = `${window.location.pathname}?reportId=${encodeURIComponent(repId)}&program=${encodeURIComponent(slug)}&format=pdf`;
        window.history.pushState({ reportId: repId, view: 'pdf' }, '', newUrl);
      } else if (view === 'view' && repId) {
        const newUrl = `${window.location.pathname}?reportId=${encodeURIComponent(repId)}&program=${encodeURIComponent(slug)}`;
        window.history.pushState({ reportId: repId, view: 'view' }, '', newUrl);
      } else if (view === 'dashboard') {
        window.history.pushState({ view: 'dashboard' }, '', window.location.pathname);
      }
    }
  };

  const syncUserToFirestore = async (firebaseUser: any) => {
    if (!firebaseUser || firebaseUser.isGuest) return;
    try {
      const userRef = doc(db, 'users', firebaseUser.uid);
      const userSnap = await getDoc(userRef);
      const isAdmin = firebaseUser.email === 'marvinisaac24@gmail.com';
      const userData = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        displayName: firebaseUser.displayName || 'Guru',
        photoURL: firebaseUser.photoURL || '',
        role: isAdmin ? 'admin' : 'guru',
        lastLogin: serverTimestamp(),
        ...(!userSnap.exists() ? { createdAt: serverTimestamp() } : { updatedAt: serverTimestamp() })
      };
      await setDoc(userRef, userData, { merge: true });
    } catch (e) {
      console.warn("Could not sync user profile to Firestore:", e);
    }
  };

  useEffect(() => {
    let unsubLatest: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const isAdmin = currentUser.email === 'marvinisaac24@gmail.com';
        setUser({
          ...currentUser,
          role: isAdmin ? 'admin' : 'guru',
          isGuest: false
        });
        await syncUserToFirestore(currentUser);
      } else {
        setUser(DEFAULT_GUEST_USER);
      }
      setLoading(false);
      setHasDriveAccess(!!getGoogleAccessToken());
      
      // Listen for reports to allow direct "Paparan OPR" navigation
      try {
        const q = collection(db, 'reports');
        unsubLatest = onSnapshot(q, (snapshot) => {
          if (!snapshot.empty) {
            const sortedDocs = [...snapshot.docs].sort((a, b) => {
              const dataA = a.data();
              const dataB = b.data();
              const timeA = dataA.createdAt?.toMillis?.() || (dataA.createdAt?.seconds ? dataA.createdAt.seconds * 1000 : 0) || (dataA.tarikhPelaksanaan ? new Date(dataA.tarikhPelaksanaan).getTime() : 0) || 0;
              const timeB = dataB.createdAt?.toMillis?.() || (dataB.createdAt?.seconds ? dataB.createdAt.seconds * 1000 : 0) || (dataB.tarikhPelaksanaan ? new Date(dataB.tarikhPelaksanaan).getTime() : 0) || 0;
              return timeB - timeA;
            });
            const firstId = sortedDocs[0]?.id;
            if (firstId) {
              setLatestReportId(firstId);
            }
          }
        }, (err) => {
          console.warn("Could not listen for reports:", err);
        });
      } catch (e) {
        console.warn("Could not listen for latest report", e);
      }
    });
    
    const handleDriveChange = () => {
      setHasDriveAccess(!!getGoogleAccessToken());
    };
    window.addEventListener('driveAccessChanged', handleDriveChange);

    return () => {
      unsubscribe();
      if (unsubLatest) unsubLatest();
      window.removeEventListener('driveAccessChanged', handleDriveChange);
    };
  }, []);

  const handleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      // Get Google Access Token for Drive API
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        localStorage.setItem('googleAccessToken', credential.accessToken);
        localStorage.setItem('googleTokenTime', Date.now().toString());
        setHasDriveAccess(true);
      }
      await syncUserToFirestore(result.user);
      toast.success(`Selamat datang, ${result.user.displayName || 'Guru'}!`);
    } catch (error: any) {
      console.error('Login error:', error);
      if (error.code === 'auth/popup-closed-by-user') {
        toast('Log masuk Google dibatalkan. Jika tetingkap pop-up tersekat, sila buka pautan aplikasi dalam tab baharu. Anda tetap boleh menggunakan semua fungsi sistem seperti biasa.', { icon: 'ℹ️', duration: 7000 });
      } else if (error.code === 'auth/unauthorized-domain') {
        toast('Domain aplikasi belum didaftarkan di Firebase Auth Console. Anda tetap boleh melihat dan mengurus semua laporan dalam mod guru.', { icon: 'ℹ️', duration: 7000 });
      } else {
        toast.error(`Ralat log masuk: ${error.message || 'Sila cuba lagi.'}`);
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('googleAccessToken');
      localStorage.removeItem('googleTokenTime');
      setHasDriveAccess(false);
      setUser(DEFAULT_GUEST_USER);
      setCurrentView('dashboard');
      setSelectedReportId(null);
      toast.success('Log keluar berjaya. Anda kini dalam mod Guru SK Tudan.');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col print:bg-white">
      <Toaster position="top-center" />
      {currentView !== 'pdf' && (
        <header className="bg-white shadow-sm sticky top-0 z-30 print:hidden border-b border-gray-100">
          <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-2">
            {/* Logo & Brand */}
          <div 
            className="flex items-center gap-2.5 cursor-pointer shrink-0"
            onClick={() => setCurrentView('dashboard')}
          >
            <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <FileText size={20} />
            </div>
            <div>
              <span className="font-bold text-gray-900 text-base leading-tight block">SK Tudan Reports</span>
              <span className="text-[10px] text-gray-500 hidden sm:block">Sistem One Page Report (OPR)</span>
            </div>
          </div>

          {/* Navigasi Utama Aplikasi */}
          <nav className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => setCurrentView('dashboard')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                currentView === 'dashboard'
                  ? 'bg-blue-50 text-blue-700 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <LayoutDashboard size={16} />
              <span className="hidden md:inline">Senarai Laporan</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const targetId = selectedReportId || latestReportId;
                if (targetId) {
                  setSelectedReportId(targetId);
                  setCurrentView('view');
                } else {
                  toast('Sila cipta laporan terlebih dahulu untuk melihat Paparan OPR.', { icon: 'ℹ️' });
                  setCurrentView('create');
                }
              }}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                currentView === 'view'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-blue-700 bg-blue-50/80 hover:bg-blue-100'
              }`}
              title="Buka Paparan OPR Rasmi"
            >
              <Eye size={16} />
              <span>Paparan OPR</span>
            </button>

            {/* Direct OPR PDF Viewer navigation button */}
            <button
              type="button"
              onClick={() => {
                const targetId = selectedReportId || latestReportId;
                if (targetId) {
                  navigateToView('pdf', targetId);
                } else {
                  toast('Sila pilih atau cipta laporan terlebih dahulu untuk melihat format PDF.', { icon: 'ℹ️' });
                  setCurrentView('create');
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                currentView === 'pdf'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-red-700 bg-red-50/90 hover:bg-red-100 border border-red-200/80'
              }`}
              title="Buka Dokumen OPR dalam Format PDF (Format QR Code)"
            >
              <FileText size={16} className={currentView === 'pdf' ? 'text-white' : 'text-red-600'} />
              <span>Format PDF</span>
              <span className={`text-[9px] font-extrabold px-1 py-0.2 rounded uppercase ${
                currentView === 'pdf' ? 'bg-white text-red-700' : 'bg-red-600 text-white'
              }`}>
                PDF
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedReportId(null);
                setCurrentView('create');
              }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                currentView === 'create'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <Plus size={16} />
              <span className="hidden sm:inline">Laporan Baru</span>
            </button>
          </nav>

          {/* User actions */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {!user.isGuest && !hasDriveAccess ? (
              <button
                onClick={handleLogin}
                className="hidden lg:flex items-center gap-1.5 text-xs bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full hover:bg-blue-100 transition-colors font-medium"
                title="Connect Google Drive for Auto-Sync"
              >
                <Cloud size={14} />
                Connect Drive
              </button>
            ) : !user.isGuest && hasDriveAccess ? (
              <div className="hidden lg:flex items-center gap-1 text-xs text-green-600 bg-green-50 px-3 py-1.5 rounded-full font-medium" title="Google Drive Auto-Sync Active">
                <Cloud size={14} />
                Drive Synced
              </div>
            ) : null}

            {user.isGuest ? (
              <button
                type="button"
                onClick={handleLogin}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-xs transition-colors"
                title="Log Masuk dengan akaun Google (Pilihan)"
              >
                <LogIn size={15} />
                <span>Log Masuk Google</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 text-xs text-gray-700 bg-gray-50 border border-gray-200 px-2.5 py-1 rounded-full">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="Profile" className="w-6 h-6 rounded-full border border-gray-200" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-[11px]">
                      {user.displayName?.charAt(0) || 'G'}
                    </div>
                  )}
                  <span className="truncate max-w-[100px] font-semibold text-gray-900 hidden sm:inline">{user.displayName}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                    {user.role === 'admin' ? 'Admin' : 'Guru'}
                  </span>
                </div>
                {user.email === 'marvinisaac24@gmail.com' && (
                  <button
                    onClick={() => setCurrentView('admin')}
                    className={`p-2 rounded-full transition-colors ${currentView === 'admin' ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50'}`}
                    title="Tetapan Admin"
                  >
                    <Settings size={18} />
                  </button>
                )}
                <button
                  onClick={handleLogout}
                  className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                  title="Sign out"
                >
                  <LogOut size={18} />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      )}

      <main className={currentView === 'pdf' ? 'w-full flex-1 print:p-0' : 'flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 print:max-w-none print:p-0'}>
        {currentView === 'dashboard' && (
          <Dashboard 
            onView={(id) => navigateToView('view', id)}
            onEdit={(id) => navigateToView('edit', id)}
            onCreate={() => navigateToView('create', null)}
          />
        )}
        {currentView === 'create' && (
          <ReportForm 
            onBack={() => navigateToView('dashboard')}
            onSaved={(id) => navigateToView('view', id)}
          />
        )}
        {currentView === 'edit' && selectedReportId && (
          <ReportForm 
            reportId={selectedReportId}
            onBack={() => navigateToView('dashboard')}
            onSaved={(id) => navigateToView('view', id)}
          />
        )}
        {currentView === 'view' && (
          (selectedReportId || latestReportId) ? (
            <ReportDetail 
              reportId={(selectedReportId || latestReportId)!}
              onBack={() => navigateToView('dashboard')}
              onEdit={() => navigateToView('edit', selectedReportId || latestReportId)}
              onViewPdf={() => navigateToView('pdf', selectedReportId || latestReportId)}
            />
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center max-w-md mx-auto my-12">
              <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText size={32} />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Tiada Laporan Untuk Dipaparkan</h3>
              <p className="text-gray-500 text-sm mb-6">Sila cipta One Page Report pertama anda untuk melihat Paparan OPR rasmi.</p>
              <button
                onClick={() => setCurrentView('create')}
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors font-semibold text-sm shadow-sm"
              >
                <Plus size={18} />
                Cipta Laporan OPR Sekarang
              </button>
            </div>
          )
        )}
        {currentView === 'pdf' && (
          (selectedReportId || latestReportId) ? (
            <OprPdfViewer 
              reportId={(selectedReportId || latestReportId)!}
              onBackToDashboard={() => navigateToView('dashboard')}
            />
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center max-w-md mx-auto my-12">
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText size={32} />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Tiada Laporan Untuk Dipaparkan</h3>
              <p className="text-gray-500 text-sm mb-6">Sila pilih laporan OPR dari papan pemuka untuk melihat dokumen PDF.</p>
              <button
                onClick={() => navigateToView('dashboard')}
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors font-semibold text-sm shadow-sm"
              >
                Kembali ke Papan Pemuka
              </button>
            </div>
          )
        )}
        {currentView === 'admin' && (
          <AdminSettings onBack={() => setCurrentView('dashboard')} />
        )}
      </main>
    </div>
  );
}
