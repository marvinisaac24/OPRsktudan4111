import fs from 'fs';

let dash = fs.readFileSync('src/components/Dashboard.tsx', 'utf-8');
dash = dash.replace(
  /<h1 style="font-family: Arial, sans-serif; font-size: 12pt; font-weight: bold; margin-bottom: 1.5cm; text-transform: uppercase; text-align: center; line-height: 1.3;">\s*\$\{report\.namaProgram \|\| 'ONE PAGE REPORT \(OPR\)'\}\s*<\/h1>/g,
  `<div style="font-family: Arial, sans-serif; text-align: center; margin-bottom: 1.5cm; line-height: 1.3;">
                <h1 style="font-size: 12pt; font-weight: bold; text-transform: uppercase; margin: 0 0 8px 0;">ONE PAGE REPORT (OPR)</h1>
                <h2 style="font-size: 12pt; font-weight: bold; text-transform: uppercase; margin: 0;">\${report.namaProgram || ''}</h2>
              </div>`
);
fs.writeFileSync('src/components/Dashboard.tsx', dash);

let rep = fs.readFileSync('src/components/ReportDetail.tsx', 'utf-8');
rep = rep.replace(
  /<h1 style={{ fontSize: '12pt', fontWeight: 'bold', textAlign: 'center', marginBottom: '1.5cm', textTransform: 'uppercase', fontFamily: '"Arial", sans-serif' }}>\s*\{report\.namaProgram \|\| 'ONE PAGE REPORT \(OPR\)'\}\s*<\/h1>/g,
  `<div style={{ textAlign: 'center', marginBottom: '1.5cm', fontFamily: '"Arial", sans-serif' }}>
            <h1 style={{ fontSize: '12pt', fontWeight: 'bold', textTransform: 'uppercase', margin: '0 0 8px 0', lineHeight: 1.3 }}>ONE PAGE REPORT (OPR)</h1>
            <h2 style={{ fontSize: '12pt', fontWeight: 'bold', textTransform: 'uppercase', margin: 0, lineHeight: 1.3 }}>{report.namaProgram || ''}</h2>
          </div>`
);
fs.writeFileSync('src/components/ReportDetail.tsx', rep);
