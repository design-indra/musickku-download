# MusicKu Download API
Backend khusus download MP3 dari YouTube untuk aplikasi MusicKu.

## Endpoints
- `GET /` - Health check
- `POST /api/download` - Start download `{ videoId, title }`
- `GET /api/download/progress/:jobId` - Cek progress
- `GET /api/download/file/:jobId` - Ambil file MP3
