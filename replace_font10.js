import fs from 'fs';

for (const path of ['src/components/ReportDetail.tsx', 'src/components/Dashboard.tsx']) {
  if (!fs.existsSync(path)) continue;
  let content = fs.readFileSync(path, 'utf-8');
  
  // change base 11pt to 10pt
  content = content.replace(/font-size: 11pt/g, 'font-size: 10pt');
  
  // change class text-[11pt] to text-[10pt]
  content = content.replace(/text-\[11pt\]/g, 'text-[10pt]');
  
  // change line-height: 1.5 to 1.15 for body/school-info
  content = content.replace(/line-height: 1\.5;/g, 'line-height: 1.15;');

  // Make sure to apply Arial properly to the main preview if needed, 
  // but it seems the print/html already has Arial.
  // We'll also make sure the React preview table has 10pt and 1.15 line-height if it has 11pt.
  content = content.replace(/fontSize: '11pt'/g, "fontSize: '10pt'");
  
  fs.writeFileSync(path, content);
}
