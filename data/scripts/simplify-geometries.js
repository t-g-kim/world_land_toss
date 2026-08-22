import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(__dirname, '..', 'raw');
const OUT_DIR = join(__dirname, '..', 'processed');

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

// Dynamic import for @turf/simplify
async function main() {
  let simplify;
  try {
    const mod = await import('@turf/simplify');
    simplify = mod.default || mod.simplify;
  } catch {
    console.error('Install @turf/simplify: npm install @turf/simplify');
    process.exit(1);
  }

  const configs = [
    {
      input: 'countries.geojson',
      output: 'countries.geojson',
      tolerance: 0.01,
      adminLevel: 'country',
      nameField: 'NAME',
      isoField: 'ISO_A3',
      popField: 'POP_EST',
    },
    {
      input: 'provinces.geojson',
      output: 'provinces.geojson',
      tolerance: 0.005,
      adminLevel: 'province',
      nameField: 'name',
      isoField: 'iso_3166_2',
      popField: null,
    },
    {
      input: 'geoBoundariesCGAZ_ADM2.geojson',
      output: 'districts.geojson',
      tolerance: 0.002,
      adminLevel: 'district',
      nameField: 'shapeName',
      isoField: 'shapeISO',
      popField: null,
    },
  ];

  for (const config of configs) {
    const inputPath = join(RAW_DIR, config.input);
    if (!existsSync(inputPath)) {
      console.log(`Skipping ${config.input} (not found)`);
      continue;
    }

    console.log(`Processing ${config.input}...`);
    const raw = JSON.parse(readFileSync(inputPath, 'utf-8'));

    const features = raw.features.map((f, idx) => {
      // Simplify geometry
      let simplified;
      try {
        simplified = simplify(f, {
          tolerance: config.tolerance,
          highQuality: true,
        });
      } catch {
        simplified = f; // Keep original if simplify fails
      }

      const props = f.properties || {};
      const name = props[config.nameField] || props.name || props.NAME || `Territory ${idx}`;
      const isoCode = props[config.isoField] || props.ISO_A3 || props.iso_a2 || '';
      const population = config.popField ? (props[config.popField] || 0) : 0;

      // Calculate centroid (approximate)
      let centerLng = 0, centerLat = 0;
      try {
        const coords = flattenCoords(simplified.geometry);
        if (coords.length > 0) {
          centerLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
          centerLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
        }
      } catch {}

      return {
        type: 'Feature',
        geometry: simplified.geometry,
        properties: {
          id: `${config.adminLevel}_${isoCode || idx}`,
          name,
          iso_code: isoCode,
          admin_level: config.adminLevel,
          population,
          center_lng: Math.round(centerLng * 1000) / 1000,
          center_lat: Math.round(centerLat * 1000) / 1000,
          ...(props.admin ? { parent_name: props.admin } : {}),
          ...(props.CONTINENT ? { continent: props.CONTINENT } : {}),
        },
      };
    });

    const output = {
      type: 'FeatureCollection',
      features,
    };

    const outputPath = join(OUT_DIR, config.output);
    writeFileSync(outputPath, JSON.stringify(output));
    console.log(`  -> ${features.length} features -> ${config.output} (${(Buffer.byteLength(JSON.stringify(output)) / 1024 / 1024).toFixed(1)} MB)`);
  }

  console.log('\nDone! Run "npm run data:seed" to generate DB seeds.');
}

function flattenCoords(geometry) {
  if (!geometry || !geometry.coordinates) return [];
  const type = geometry.type;

  if (type === 'Point') return [geometry.coordinates];
  if (type === 'MultiPoint' || type === 'LineString') return geometry.coordinates;
  if (type === 'MultiLineString' || type === 'Polygon') return geometry.coordinates.flat();
  if (type === 'MultiPolygon') return geometry.coordinates.flat(2);
  return [];
}

main().catch(console.error);
