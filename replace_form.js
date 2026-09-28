import fs from 'fs';

let content = fs.readFileSync('src/components/ReportForm.tsx', 'utf-8');

if (!content.includes('singkatanProgram:')) {
  content = content.replace(/namaProgram:\s*'',/, "namaProgram: '',\n    singkatanProgram: '',");
}

content = content.replace(/namaProgram:\s*data\.namaProgram\s*\|\|\s*'',/g, "namaProgram: data.namaProgram || '',\n                singkatanProgram: data.singkatanProgram || '',");

if (!content.includes('name="singkatanProgram"')) {
  // Find the namaProgram input div block, and append after it.
  content = content.replace(
    /(<input[^>]*name="namaProgram"[\s\S]*?<\/div>\s*<\/div>)/,
    `$1\n          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Singkatan Program (Pilihan, paparan di muka depan)
            </label>
            <input
              type="text"
              name="singkatanProgram"
              value={formData.singkatanProgram || ''}
              onChange={handleChange}
              className="w-full p-2 border rounded-md focus:ring-2 focus:ring-blue-500"
              placeholder="Cth: KMD"
            />
          </div>`
  );
}

fs.writeFileSync('src/components/ReportForm.tsx', content);

// Update Dashboard.tsx
let dash = fs.readFileSync('src/components/Dashboard.tsx', 'utf-8');
dash = dash.replace(/\$\{report\.namaProgram \|\| ''\}/g, "${report.singkatanProgram || report.namaProgram || ''}");
fs.writeFileSync('src/components/Dashboard.tsx', dash);

// Update ReportDetail.tsx 
let rep = fs.readFileSync('src/components/ReportDetail.tsx', 'utf-8');
rep = rep.replace(/\{report\.namaProgram \|\| ''\}/g, "{report.singkatanProgram || report.namaProgram || ''}");
rep = rep.replace(/\$\{report\.namaProgram \|\| ''\}/g, "${report.singkatanProgram || report.namaProgram || ''}");
fs.writeFileSync('src/components/ReportDetail.tsx', rep);
