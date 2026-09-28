import fs from 'fs';
let rd = fs.readFileSync('src/components/ReportDetail.tsx', 'utf-8');
rd = rd.replace(/height: 50px;/g, 'height: 80px;');
rd = rd.replace(/max-h-\[50px\]/g, 'max-h-[80px]');
fs.writeFileSync('src/components/ReportDetail.tsx', rd);

let db = fs.readFileSync('src/components/Dashboard.tsx', 'utf-8');
db = db.replace(/height: 50px;/g, 'height: 80px;');
fs.writeFileSync('src/components/Dashboard.tsx', db);
