# LedgerApp Backend

Backend API for expense tracking, budget management, and OCR-assisted receipt ingestion.

Current OCR support:
- `image/*` uploads are processed with Tesseract OCR
- `text/*` uploads are parsed directly as UTF-8 text
- PDF files are not yet OCR-processed in this first pass

## Quick Start

1. Install dependencies:
   - `npm install`
2. Configure `.env` using `.env.example`.
3. Run dev server:
   - `npm run dev`

## Docker

- Run with Docker Compose:
  - `docker compose up --build`

## API Baseline

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `POST /expenses`
- `GET /expenses`
- `POST /receipts/upload`
- `GET /receipts/:id/status`
- `POST /budgets`
- `GET /insights/monthly`
