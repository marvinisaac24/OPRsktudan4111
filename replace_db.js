import fs from 'fs';
const path = 'src/components/Dashboard.tsx';
let content = fs.readFileSync(path, 'utf-8');

// Dashboard HTML string sizes
content = content.replace(/height: 100px; background-color: #f3f4f6;/g, 'height: 75px; background-color: #f3f4f6;');
content = content.replace(/height: 70px;/g, 'height: 50px;');

fs.writeFileSync(path, content);
