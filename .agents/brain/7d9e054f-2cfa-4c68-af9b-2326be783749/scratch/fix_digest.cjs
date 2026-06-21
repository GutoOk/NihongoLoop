const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../../../../schema.sql');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Replace digest(...) without public. namespace with public.digest(...)
content = content.replace(/(?<!public\.|extensions\.|%I\.)digest\(/g, 'public.digest(');

// 2. Ensure all 'sha256' strings in the file (which are arguments to digest) use 'sha256'::text
content = content.replace(/'sha256'(?!\s*::\s*text)/g, "'sha256'::text");

fs.writeFileSync(filePath, content, 'utf8');
console.log('Done');
