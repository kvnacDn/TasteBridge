export async function readSecret() {
  if (process.env.QLOO_API_KEY) return process.env.QLOO_API_KEY;
  if (!process.argv.includes('--stdin-secret')) throw new Error('QLOO_API_KEY is required.');
  process.stderr.write('Ready for secret JSON on stdin (input is hidden).\n');
  return new Promise((resolve, reject) => {
    let buffer = '';
    const tty = process.stdin.isTTY;
    if (tty) process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    const done = () => { process.stdin.removeListener('data', receive); if (tty) process.stdin.setRawMode(false); process.stdin.pause(); };
    const receive = chunk => {
      buffer += chunk;
      if (buffer.length > 4096) { done(); reject(new Error('Secret input is invalid.')); return; }
      if (buffer.includes('\n')) { done(); try { const value = JSON.parse(buffer.trim()).apiKey; if (typeof value !== 'string' || !value) throw new Error(); resolve(value); } catch { reject(new Error('Secret input is invalid.')); } }
    };
    process.stdin.on('data', receive);
    process.stdin.resume();
  });
}
