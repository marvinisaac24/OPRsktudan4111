import fs from 'fs';

for (const path of ['src/components/ReportDetail.tsx', 'src/components/Dashboard.tsx']) {
  if (!fs.existsSync(path)) continue;
  let content = fs.readFileSync(path, 'utf-8');
  
  // Replace HTML template parts
  content = content.replace(/font-size: 9pt; font-style: italic;/g, 'font-size: 9pt; font-family: Arial, sans-serif;');
  
  // Replace React TSX parts for image desc
  content = content.replace(/className="text-center text-\[9pt\] italic mt-0\.5 leading-tight font-sans"/g, 'className="text-center text-[9pt] mt-0.5 leading-tight" style={{ fontFamily: "Arial, sans-serif" }}');
  content = content.replace(/className="text-center text-\[9pt\] italic mt-1 leading-tight text-gray-600"/g, 'className="text-center text-[9pt] mt-1 leading-tight text-gray-600" style={{ fontFamily: "Arial, sans-serif" }}');
  
  // Also fix the other text style below grid
  content = content.replace(/font-size: 9pt; text-align: center; font-style: italic;/g, 'font-size: 9pt; font-family: Arial, sans-serif; text-align: center;');
  
  fs.writeFileSync(path, content);
}
