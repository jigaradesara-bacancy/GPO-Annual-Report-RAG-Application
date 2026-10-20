import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import { badRequest } from '../utils/errors.js';

/** Files land in a private temp dir under server-generated names; the client filename is never used as a path. */
export function createUpload(storageDir: string, maxBytes: number) {
  const tmp = path.join(storageDir, 'tmp');
  mkdirSync(tmp, { recursive: true });
  return multer({
    storage: multer.diskStorage({ destination: tmp, filename: (_req, _file, cb) => cb(null, `${randomUUID()}.pdf`) }),
    limits: { fileSize: maxBytes, files: 1, fields: 5 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype !== 'application/pdf') return cb(badRequest('INVALID_FILE_TYPE', 'Only PDF files (application/pdf) are accepted.'));
      cb(null, true);
    },
  }).single('file');
}
