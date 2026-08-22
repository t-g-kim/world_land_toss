import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'processed');
const SUPABASE_DIR = join(__dirname, '..', '..', 'supabase');

const LEVEL_FACTORS = {
  country: 5_000_000,
  province: 500_000,
  district: 50_000,
};

const SIGNIFICANCE_MAP = {
  // Major capitals and cities
  'United States of America': 10, 'China': 10, 'Japan': 9, 'Germany': 9,
  'United Kingdom': 9, 'France': 9, 'India': 9, 'Brazil': 8,
  'South Korea': 8, 'Canada': 7, 'Australia': 7, 'Russia': 8,
  'Italy': 8, 'Spain': 7, 'Mexico': 7, 'Indonesia': 7,
};

function calculateBasePrice(feature) {
  const props = feature.properties;
  const level = props.admin_level;
  const levelFactor = LEVEL_FACTORS[level] || 50_000;
  const pop = props.population || 1;
  const sig = SIGNIFICANCE_MAP[props.name] || 3;

  // Approximate area from geometry
  let area = 1;
  try {
    const coords = flattenCoords(feature.geometry);
    if (coords.length >= 3) {
      // Very rough area from bounding box
      const lngs = coords.map(c => c[0]);
      const lats = coords.map(c => c[1]);
      const dLng = Math.max(...lngs) - Math.min(...lngs);
      const dLat = Math.max(...lats) - Math.min(...lats);
      area = Math.max(dLng * dLat * 12321, 1); // rough km² approximation
    }
  } catch {}

  const areaFactor = area > 0 ? Math.log(area + 1) : 1;
  const popFactor = pop > 0 ? Math.log(pop + 1) : 1;
  const sigFactor = sig / 5;

  return Math.round(levelFactor * areaFactor * popFactor * sigFactor);
}

function flattenCoords(geometry) {
  if (!geometry || !geometry.coordinates) return [];
  const type = geometry.type;
  if (type === 'Polygon') return geometry.coordinates.flat();
  if (type === 'MultiPolygon') return geometry.coordinates.flat(2);
  return [];
}

function main() {
  const files = ['countries.geojson', 'provinces.geojson', 'districts.geojson'];
  const inserts = [];

  for (const file of files) {
    const path = join(DATA_DIR, file);
    if (!existsSync(path)) {
      console.log(`Skipping ${file} (not found)`);
      continue;
    }

    console.log(`Processing ${file}...`);
    const geojson = JSON.parse(readFileSync(path, 'utf-8'));

    for (const feature of geojson.features) {
      const props = feature.properties;
      const basePrice = calculateBasePrice(feature);
      const incomePerHour = Math.round((basePrice / 1000) * 0.95);
      const geomJson = JSON.stringify(feature.geometry);

      // Escape single quotes for SQL
      const name = (props.name || '').replace(/'/g, "''");
      const isoCode = (props.iso_code || '').replace(/'/g, "''");

      inserts.push(
        `INSERT INTO territories (id, name, iso_code, admin_level, geometry, base_price, current_price, income_per_hour, population, significance, center_lng, center_lat)` +
        ` VALUES ('${props.id}', '${name}', '${isoCode}', '${props.admin_level}',` +
        ` ST_GeomFromGeoJSON('${geomJson}'),` +
        ` ${basePrice}, ${basePrice}, ${incomePerHour}, ${props.population || 0}, ${SIGNIFICANCE_MAP[props.name] || 3},` +
        ` ${props.center_lng || 0}, ${props.center_lat || 0})` +
        ` ON CONFLICT (id) DO NOTHING;`
      );
    }

    console.log(`  -> ${geojson.features.length} territories`);
  }

  const sql = `-- Auto-generated territory seed data
-- Generated at ${new Date().toISOString()}

BEGIN;

${inserts.join('\n')}

COMMIT;
`;

  const outputPath = join(SUPABASE_DIR, 'seed.sql');
  writeFileSync(outputPath, sql);
  console.log(`\nSeed SQL written to ${outputPath} (${inserts.length} territories)`);
}

main();
