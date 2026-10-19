'use strict';
// Creates a tiny fake "backend" folder (requirements + check_env.py) so runtime tests need no repo files.
const fs = require('fs'), os = require('os'), path = require('path');
module.exports = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-backend-'));
  fs.mkdirSync(path.join(dir, 'requirements'));
  fs.writeFileSync(path.join(dir, 'requirements', 'testeng.txt'), 'soundfile\nnumpy\ntqdm\n');
  fs.copyFileSync(path.join(__dirname, '..', 'backend', 'check_env.py'), path.join(dir, 'check_env.py'));
  return dir;
};
