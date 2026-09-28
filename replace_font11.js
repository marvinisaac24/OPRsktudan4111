import fs from 'fs';

for (const path of ['src/components/ReportDetail.tsx', 'src/components/Dashboard.tsx']) {
  if (!fs.existsSync(path)) continue;
  let content = fs.readFileSync(path, 'utf-8');
  
  // change base 10pt to 11pt
  content = content.replace(/font-size: 10pt/g, 'font-size: 11pt');
  
  // change class text-[10pt] to text-[11pt]
  content = content.replace(/text-\[10pt\]/g, 'text-[11pt]');
  
  content = content.replace(/fontSize: '10pt'/g, "fontSize: '11pt'");
  
  fs.writeFileSync(path, content);
}
