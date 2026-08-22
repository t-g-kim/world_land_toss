#!/bin/bash
# Download administrative boundary data from Natural Earth and geoBoundaries
set -e

RAW_DIR="$(dirname "$0")/../raw"
mkdir -p "$RAW_DIR"

echo "=== Downloading Natural Earth data ==="

# Countries (1:50m - lighter weight)
echo "  -> Countries (ADM0) 1:50m..."
curl -sL -o "$RAW_DIR/ne_50m_admin_0_countries.zip" \
  "https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip"
unzip -o "$RAW_DIR/ne_50m_admin_0_countries.zip" -d "$RAW_DIR/countries" > /dev/null

# Provinces/States (1:10m for detail)
echo "  -> Provinces (ADM1) 1:10m..."
curl -sL -o "$RAW_DIR/ne_10m_admin_1_states_provinces.zip" \
  "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip"
unzip -o "$RAW_DIR/ne_10m_admin_1_states_provinces.zip" -d "$RAW_DIR/provinces" > /dev/null

echo "=== Downloading geoBoundaries data ==="

# Districts (ADM2) - from geoBoundaries CGAZ
echo "  -> Districts (ADM2) - geoBoundaries CGAZ..."
curl -sL -o "$RAW_DIR/geoBoundariesCGAZ_ADM2.geojson" \
  "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/CGAZ/geoBoundariesCGAZ_ADM2.geojson" || \
echo "  Note: ADM2 download may fail due to file size. Use the simplified version below."

echo ""
echo "=== Converting shapefiles to GeoJSON ==="

# Check for ogr2ogr
if ! command -v ogr2ogr &> /dev/null; then
  echo "WARNING: ogr2ogr not found. Install GDAL to convert shapefiles."
  echo "  brew install gdal  (macOS)"
  echo "  sudo apt install gdal-bin  (Ubuntu)"
  echo ""
  echo "Attempting to use shapefile directly..."
else
  echo "  -> Converting countries..."
  ogr2ogr -f GeoJSON "$RAW_DIR/countries.geojson" \
    "$RAW_DIR/countries/ne_50m_admin_0_countries.shp" \
    -select "NAME,ISO_A3,ISO_A2,POP_EST,GDP_MD,CONTINENT,SUBREGION" 2>/dev/null || true

  echo "  -> Converting provinces..."
  ogr2ogr -f GeoJSON "$RAW_DIR/provinces.geojson" \
    "$RAW_DIR/provinces/ne_10m_admin_1_states_provinces.shp" \
    -select "name,iso_a2,admin,iso_3166_2,type_en" 2>/dev/null || true
fi

echo ""
echo "=== Download complete ==="
echo "Run 'npm run data:simplify' next to simplify geometries."
