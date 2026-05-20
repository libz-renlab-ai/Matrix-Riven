import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { downloadOneFile, downloadAllFiles } from '../download.js';
import type { ClientManifestFile } from '../types.js';

const BODY = Buffer.from('hello world', 'utf8');
const SHA = createHash('sha256').update(BODY).digest('hex');

let server: Server;
let url: string;

beforeEach(async () => {
  server = createServer((req, res) => {
    if (req.url?.endsWith('/bin-uploader.cjs')) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(BODY);
      return;
    }
    if (req.url?.endsWith('/bin-digital-twin.cjs')) {
      // sha-mismatch case for the second call in downloadAllFiles
      res.writeHead(200);
      res.end('different bytes');
      return;
    }
    if (req.url?.endsWith('/bin-session-start.cjs')) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number } | null;
  url = `http://127.0.0.1:${addr!.port}`;
});

afterEach(() => {
  return new Promise<void>((r) => server.close(() => r()));
});

describe('downloadOneFile', () => {
  it('writes .new with correct contents on successful sha match', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'riven-dl-'));
    try {
      const f: ClientManifestFile = { name: 'bin-uploader.cjs', sha256: SHA, size: BODY.length };
      const r = await downloadOneFile(url, dir, f);
      expect(r.ok).toBe(true);
      expect(r.newPath).toBeDefined();
      const written = readFileSync(r.newPath!);
      expect(written.toString('utf8')).toBe('hello world');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('reports sha256 mismatch and cleans up .new', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'riven-dl-'));
    try {
      const f: ClientManifestFile = { name: 'bin-digital-twin.cjs', sha256: SHA, size: 100 };
      const r = await downloadOneFile(url, dir, f);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('sha256');
      expect(existsSync(join(dir, 'bin-digital-twin.cjs.new'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('reports HTTP error on 404', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'riven-dl-'));
    try {
      const f: ClientManifestFile = { name: 'bin-session-start.cjs', sha256: SHA, size: 100 };
      const r = await downloadOneFile(url, dir, f);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('http');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('downloadAllFiles', () => {
  it('cleans up earlier files when later fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'riven-dl-'));
    try {
      const files: ClientManifestFile[] = [
        { name: 'bin-uploader.cjs', sha256: SHA, size: BODY.length },
        { name: 'bin-digital-twin.cjs', sha256: SHA, size: 100 }, // will fail sha
      ];
      const r = await downloadAllFiles(url, dir, files);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.failed.name).toBe('bin-digital-twin.cjs');
        expect(r.result.reason).toBe('sha256');
      }
      // The first file's .new should be cleaned up
      expect(existsSync(join(dir, 'bin-uploader.cjs.new'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
