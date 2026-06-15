import https from 'https';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const url = 'https://github.com/GutoOk/NihongoLoop/archive/refs/heads/main.zip';
const zipPath = path.join(process.cwd(), 'main.zip');

console.log('Downloading repository...');
const file = fs.createWriteStream(zipPath);

https.get(url, (response) => {
  if (response.statusCode === 301 || response.statusCode === 302) {
    https.get(response.headers.location, (res) => {
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log('Download complete. Extracting...');
        extractZip();
      });
    });
  } else {
    response.pipe(file);
    file.on('finish', () => {
      file.close();
      console.log('Download complete. Extracting...');
      extractZip();
    });
  }
}).on('error', (err) => {
  console.error('Error downloading:', err.message);
});

function extractZip() {
  try {
    execSync('npx -y unzipper -d temp_extract main.zip');
    
    const tempDir = path.join(process.cwd(), 'temp_extract', 'NihongoLoop-main');
    if (fs.existsSync(tempDir)) {
      console.log('Copying files...');
      copyRecursiveSync(tempDir, process.cwd());
      console.log('Cleaning up...');
      fs.rmSync(path.join(process.cwd(), 'temp_extract'), { recursive: true, force: true });
      fs.rmSync(zipPath, { force: true });
      console.log('Update successful!');
    } else {
      console.log('Expected directory NihongoLoop-main not found after extraction.');
    }
  } catch (err) {
    console.error('Extraction/Copy error:', err);
  }
}

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest);
    }
    fs.readdirSync(src).forEach(function(childItemName) {
      if (childItemName === '.git') return;
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}
