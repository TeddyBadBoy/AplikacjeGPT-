import { createWorker } from 'tesseract.js';

function findDecimalCoordinates(text) {
  const normalized = String(text || '')
    .replace(/[|]/g, '1')
    .replace(/[Oo](?=\d)/g, '0')
    .replace(/(?<=\d)[Oo]/g, '0');
  const matches = [];
  const patterns = [
    /(-?\d{1,2}[.,]\d{4,})\s*[,;\s]\s*(-?\d{1,3}[.,]\d{4,})/g,
    /(?:lat(?:itude)?\s*[:=]?\s*)(-?\d{1,2}[.,]\d{4,}).{0,40}?(?:lon(?:gitude)?|lng)\s*[:=]?\s*(-?\d{1,3}[.,]\d{4,})/gis
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(normalized))) {
      const lat = Number(m[1].replace(',', '.'));
      const lon = Number(m[2].replace(',', '.'));
      if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        matches.push({ lat, lon, verbatim: m[0].trim(), confidence: 0.75 });
      }
    }
  }
  const seen = new Set();
  return matches.filter(c => { const k=`${c.lat},${c.lon}`; if(seen.has(k)) return false; seen.add(k); return true; });
}

export async function extractCoordinatesWithOcr(buffer) {
  const worker = await createWorker('eng');
  try {
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789.,;:- LATITUDElatitudLONGITUDElongitudNSEWnsew',
      preserve_interword_spaces: '1'
    });
    const { data } = await worker.recognize(buffer);
    const text = String(data?.text || '');
    return { available: true, text, confidence: Number(data?.confidence || 0) / 100, coordinates: findDecimalCoordinates(text) };
  } finally {
    await worker.terminate();
  }
}

export { findDecimalCoordinates };
