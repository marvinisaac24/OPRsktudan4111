import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';

interface Teacher {
  nama: string;
  jawatan: string;
}

interface TeacherComboboxProps {
  label?: string;
  value: string;
  jawatan: string;
  onChange: (nama: string, jawatan: string) => void;
  teachers: Teacher[];
  placeholder?: string;
}

export const TeacherCombobox: React.FC<TeacherComboboxProps> = ({ 
  label, value, jawatan, onChange, teachers, placeholder = "Pilih atau taip nama guru..." 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [wrapperRef]);

  const filteredTeachers = teachers.filter(t => 
    t.nama.toLowerCase().includes(searchTerm.toLowerCase()) || 
    t.jawatan.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelect = (teacher: Teacher) => {
    onChange(teacher.nama, teacher.jawatan);
    setSearchTerm('');
    setIsOpen(false);
  };

  const handleCustomInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val, jawatan);
    setSearchTerm(val);
    setIsOpen(true);
  };

  return (
    <div className="space-y-4" ref={wrapperRef}>
      {label && <h4 className="font-medium text-gray-700">{label}</h4>}
      
      <div className="relative">
        <div 
          className="w-full flex items-center justify-between px-4 py-3 border border-gray-300 rounded-lg bg-white cursor-pointer hover:border-blue-400 transition-colors"
          onClick={() => {
            setIsOpen(!isOpen);
            if (!isOpen && inputRef.current) {
              setTimeout(() => inputRef.current?.focus(), 100);
            }
          }}
        >
          <span className={`block truncate ${!value ? 'text-gray-400' : 'text-gray-900 font-medium uppercase'}`}>
            {value || placeholder}
          </span>
          <ChevronDown size={18} className={`text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </div>

        {isOpen && (
          <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden">
            <div className="p-2 border-b border-gray-100 flex items-center gap-2">
              <Search size={16} className="text-gray-400" />
              <input
                ref={inputRef}
                type="text"
                className="w-full text-sm outline-none"
                placeholder="Cari nama atau taip baru..."
                value={searchTerm}
                onChange={handleCustomInput}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <ul className="max-h-60 overflow-y-auto w-full py-1">
              {filteredTeachers.length > 0 ? (
                filteredTeachers.map((teacher, idx) => (
                  <li 
                    key={idx}
                    onClick={() => handleSelect(teacher)}
                    className="px-4 py-2 hover:bg-blue-50 cursor-pointer flex flex-col group transition-colors"
                  >
                    <span className="font-medium text-gray-900 group-hover:text-blue-700 uppercase">{teacher.nama}</span>
                    <span className="text-xs text-gray-500 group-hover:text-blue-500 uppercase">{teacher.jawatan}</span>
                  </li>
                ))
              ) : (
                <li className="px-4 py-3 text-sm text-gray-500 text-center">
                  Tekan enter atau tutup menu untuk gunakan nama ini.
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      {value && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg mt-2 relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
          <p className="font-bold text-gray-900 uppercase">
            {value}
          </p>
          <div className="mt-2 text-sm text-gray-600">
            <input
              type="text"
              value={jawatan}
              onChange={(e) => onChange(value, e.target.value)}
              className="w-full bg-transparent border-0 border-b border-dashed border-gray-300 p-0 py-1 focus:ring-0 focus:border-blue-500 uppercase rounded-none"
              placeholder="Jawatan (Taip di sini jika kosong)"
            />
          </div>
        </div>
      )}
    </div>
  );
};
