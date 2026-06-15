import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

async function update() {
  console.log('Downloading via degit...');
  try {
    execSync('npx -y degit GutoOk/NihongoLoop ./temp_update --force', { stdio: 'inherit' });
    console.log('Downloaded successfully. Copying files overwriting local changes...');
    
    const tempDir = path.join(process.cwd(), 'temp_update');
    copyRecursiveSync(tempDir, process.cwd());
    
    console.log('Cleaning up...');
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('Update completed successfully. The application files have been synchronized with the latest version from GitHub.');
  } catch (e) {
    console.error('Error during update:', e);
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

update();
