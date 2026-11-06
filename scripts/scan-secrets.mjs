// Fails if tracked or staged files contain credentials. Run before committing and in CI, alongside
// gitleaks, which has far broader rules. Prints file and line only, never the matched value.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const FORBIDDEN_FILES = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$)[^/]+$/,
  /\.(pem|key|p8|p12|jks|keystore|mobileprovision|cer|ipa|apk|aab)$/i,
  /(^|\/)google-services\.json$/,
  /(^|\/)GoogleService-Info\.plist$/,
  /service-account.*\.json$/i,
];

const PATTERNS = [
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[abprs]-[0-9A-Za-z-]{10,}/],
  ['Expo access token', /\bEXPO_TOKEN\s*[:=]\s*['"]?[A-Za-z0-9_-]{20,}/],
  ['encryption key value', /\bAPP_ENCRYPTION_KEY\s*[:=]\s*['"]?[A-Za-z0-9+/]{40,}={0,2}/],
  ['VAPID private key value', /\bVAPID_PRIVATE_KEY\s*[:=]\s*['"]?[A-Za-z0-9_-]{40,}/],
  [
    'database URL with a real password',
    /postgres(ql)?:\/\/(?!signaldesk:signaldesk@|unused:unused@|x@|\$\{)[^\s:'"`/]+:(?!\$\{)[^\s@'"`]+@/,
  ],
];

const list = (args) => execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);
const files = [
  ...new Set([...list(['ls-files', '-z']), ...list(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])]),
];

const problems = [];
for (const file of files) {
  if (FORBIDDEN_FILES.some((rule) => rule.test(file))) {
    problems.push(`${file}: this kind of file must not be committed`);
    continue;
  }
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\0')) continue;
  text.split('\n').forEach((line, index) => {
    for (const [label, pattern] of PATTERNS) {
      if (pattern.test(line) && !line.includes('scan-secrets:allow')) problems.push(`${file}:${index + 1}: ${label}`);
    }
  });
}

if (problems.length > 0) {
  console.error(`Possible secrets found:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`No secrets found in ${files.length} files.`);
