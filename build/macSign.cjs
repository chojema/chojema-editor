const { sign } = require('app-builder-lib/out/codeSign/macCodeSign');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

exports.default = async function customSign(opts) {
  const origApp = opts.app;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chojema-sign-'));
  const tmpApp = path.join(tmpDir, path.basename(origApp));
  try {
    execFileSync('ditto', [origApp, tmpApp]);
    execFileSync('xattr', ['-cr', tmpApp]);
    const origOptionsForFile = opts.optionsForFile;
    await sign({
      ...opts,
      app: tmpApp,
      optionsForFile: origOptionsForFile
        ? (filePath) => origOptionsForFile(filePath === tmpApp ? origApp : filePath)
        : undefined,
    });
    fs.rmSync(origApp, { recursive: true, force: true });
    execFileSync('ditto', [tmpApp, origApp]);
    execFileSync('xattr', ['-dr', 'com.apple.FinderInfo', origApp]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};
