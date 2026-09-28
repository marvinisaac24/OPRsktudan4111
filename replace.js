import fs from 'fs';
const path = 'src/components/ReportDetail.tsx';
let content = fs.readFileSync(path, 'utf-8');
content = content.replace(/className="border border-black p-1/g, 'className="border border-black p-0.5');
fs.writeFileSync(path, content);
