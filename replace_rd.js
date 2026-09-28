import fs from 'fs';
const path = 'src/components/ReportDetail.tsx';
let content = fs.readFileSync(path, 'utf-8');

// Dashboard HTML string sizes
content = content.replace(/max-height: 90px;/g, 'max-height: 75px;');
content = content.replace(/h-\[90px\]/g, 'h-[75px]');

// Fix logo height
content = content.replace(/height: 70px;/g, 'height: 50px;');
content = content.replace(/max-h-\[70px\]/g, 'max-h-[50px]');

// Fix negative margin
content = content.replace(/className="relative z-10 print:-mt-8"/g, 'className="relative z-10 print:mt-0"');

fs.writeFileSync(path, content);
