import fs from 'fs';

for (const path of ['src/components/ReportDetail.tsx', 'src/components/Dashboard.tsx']) {
  if (!fs.existsSync(path)) continue;
  let content = fs.readFileSync(path, 'utf-8');
  
  // Replace in Dashboard.tsx active cover
  content = content.replace(/'font-family: Arial, sans-serif; font-weight: bold; color: #111827; margin: 0; font-size: 15pt;/g, "'font-family: Arial, sans-serif; font-weight: bold; color: #111827; margin: 0; font-size: 12pt;");
  content = content.replace(/"font-family: Arial, sans-serif; font-weight: bold; color: #111827; margin: 0; font-size: 15pt;/g, '"font-family: Arial, sans-serif; font-weight: bold; color: #111827; margin: 0; font-size: 12pt;');

  // Replace in Dashboard.tsx custom cover
  content = content.replace(/font-size: 24pt;/g, 'font-size: 12pt;');
  
  // Replace in ReportDetail.tsx active cover
  content = content.replace(/fontSize: '15pt'/g, "fontSize: '12pt', fontFamily: 'Arial, sans-serif', fontWeight: 'bold'");
  
  // Replace in ReportDetail.tsx custom cover
  content = content.replace(/fontSize: '22pt'/g, "fontSize: '12pt'");
  content = content.replace(/fontSize: 24pt;/g, "fontSize: 12pt;");
  content = content.replace(/fontSize: 20pt;/g, "fontSize: 12pt;"); // For ONE PAGE REPORT (OPR) html export
  content = content.replace(/font-size: 24pt;/g, 'font-size: 12pt;');
  content = content.replace(/font-size: 20pt;/g, 'font-size: 12pt;'); // html export
  
  fs.writeFileSync(path, content);
}
