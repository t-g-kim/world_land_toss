import { open } from 'shapefile';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', '..', 'public', 'data');
mkdirSync(OUT_DIR, { recursive: true });

// Simple point reduction: keep every Nth point
function simplifyRing(coords, keep) {
  if (coords.length <= 4) return coords;
  const step = Math.max(1, Math.floor(coords.length / keep));
  const result = [];
  for (let i = 0; i < coords.length - 1; i += step) {
    result.push([
      Math.round(coords[i][0] * 1000) / 1000,
      Math.round(coords[i][1] * 1000) / 1000,
    ]);
  }
  // Close the ring
  result.push(result[0]);
  return result;
}

function simplifyGeometry(geom, maxPoints) {
  if (!geom) return geom;
  if (geom.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geom.coordinates.map((ring) => simplifyRing(ring, maxPoints)),
    };
  }
  if (geom.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geom.coordinates.map((poly) =>
        poly.map((ring) => simplifyRing(ring, maxPoints))
      ),
    };
  }
  return geom;
}

function getCentroid(geom) {
  let coords = [];
  if (geom.type === 'Polygon') coords = geom.coordinates[0];
  else if (geom.type === 'MultiPolygon') coords = geom.coordinates[0][0];
  if (coords.length === 0) return [0, 0];
  const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  return [Math.round(lng * 100) / 100, Math.round(lat * 100) / 100];
}

// ========================================
// Convert Countries
// ========================================
async function convertCountries() {
  console.log('Converting countries...');
  const source = await open('/tmp/ne_countries/ne_110m_admin_0_countries.shp');
  const features = [];

  let result = await source.read();
  while (!result.done) {
    const f = result.value;
    const p = f.properties || {};
    const geom = simplifyGeometry(f.geometry, 200);
    const [cLng, cLat] = getCentroid(geom);

    features.push({
      type: 'Feature',
      geometry: geom,
      properties: {
        id: `c_${p.ISO_A3 || p.ADM0_A3 || features.length}`,
        name: p.NAME || p.ADMIN || 'Unknown',
        name_ko: p.NAME_KO || '',
        iso_code: p.ISO_A3 || p.ADM0_A3 || '',
        admin_level: 'country',
        population: p.POP_EST || 0,
        gdp: p.GDP_MD || 0,
        continent: p.CONTINENT || '',
        subregion: p.SUBREGION || '',
        center_lng: cLng,
        center_lat: cLat,
      },
    });

    result = await source.read();
  }

  const geojson = { type: 'FeatureCollection', features };
  const path = join(OUT_DIR, 'countries.geojson');
  writeFileSync(path, JSON.stringify(geojson));
  const sizeMB = (Buffer.byteLength(JSON.stringify(geojson)) / 1024 / 1024).toFixed(2);
  console.log(`  -> ${features.length} countries (${sizeMB} MB) -> ${path}`);
}

// ========================================
// Convert Provinces/States
// ========================================
async function convertProvinces() {
  console.log('Converting provinces/states...');
  const source = await open('/tmp/ne_provinces/ne_10m_admin_1_states_provinces.shp');
  const features = [];

  let result = await source.read();
  while (!result.done) {
    const f = result.value;
    const p = f.properties || {};
    const geom = simplifyGeometry(f.geometry, 80);
    const [cLng, cLat] = getCentroid(geom);

    const isoCountry = p.iso_a2 || p.adm0_a3 || '';
    const isoProvince = p.iso_3166_2 || '';

    features.push({
      type: 'Feature',
      geometry: geom,
      properties: {
        id: `p_${isoProvince || isoCountry + '_' + features.length}`,
        name: p.name || p.NAME || 'Unknown',
        name_ko: p.name_ko || '',
        iso_code: isoProvince,
        country_iso: isoCountry,
        country_name: p.admin || p.ADMIN || '',
        admin_level: 'province',
        type_en: p.type_en || '',
        center_lng: cLng,
        center_lat: cLat,
      },
    });

    result = await source.read();
  }

  const geojson = { type: 'FeatureCollection', features };
  const path = join(OUT_DIR, 'provinces.geojson');
  writeFileSync(path, JSON.stringify(geojson));
  const sizeMB = (Buffer.byteLength(JSON.stringify(geojson)) / 1024 / 1024).toFixed(2);
  console.log(`  -> ${features.length} provinces (${sizeMB} MB) -> ${path}`);
}

async function main() {
  await convertCountries();
  await convertProvinces();
  console.log('\nDone! Refresh browser to see territories.');
}

main().catch(console.error);
